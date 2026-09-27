import { createHash, randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger } from 'pino';
import { type Counter } from 'prom-client';
import { type Forwarder } from './forwarder';
import { FixedWindowRateLimiter } from './rate-limiter';
import { type ReceiptStore } from './receipts';
import { type WebhookVerifier, WebhookRejected } from './verifiers';

const ROUTE = /^\/api\/v1\/webhooks\/payments\/([a-z0-9-]{2,40})$/;
const CORRELATION = /^[A-Za-z0-9-]{8,64}$/;

export interface WebhookHandlerDeps {
  verifiers: Map<string, WebhookVerifier>;
  receipts: ReceiptStore;
  forwarder: Forwarder;
  logger: Logger;
  webhooks: Counter<'provider' | 'result'>;
  maxBodyBytes: number;
  ratePerMinute: number;
  trustProxyHops: number;
  now?: () => Date;
}

type Result =
  | 'forwarded'
  | 'duplicate'
  | 'conflict'
  | 'rejected_signature'
  | 'rejected_timestamp'
  | 'rejected_payload'
  | 'unknown_provider'
  | 'forward_failed'
  | 'in_progress'
  | 'refused_by_service'
  | 'too_large'
  | 'rate_limited'
  | 'not_found';

function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function ipOf(req: IncomingMessage, hops: number): string {
  const socket = (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  const xff = req.headers['x-forwarded-for'];
  if (hops === 0 || !xff) return socket;
  const chain = (Array.isArray(xff) ? xff.join(',') : xff).split(',').map((s) => s.trim());
  return chain[chain.length - hops] ?? socket;
}

/**
 * `POST /api/v1/webhooks/payments/:provider` : prestataire activé, taille, signature et
 * horodatage (vérificateur du prestataire), normalisation, non-rejeu et idempotence (journal),
 * transmission signée au Payment Service. Réponses : 200 accepté (y compris doublon), 400/401
 * refus définitif, 409 identifiant réutilisé, 503 à réessayer par le PSP.
 */
export function createWebhookHandler(deps: WebhookHandlerDeps) {
  const limiter = new FixedWindowRateLimiter(deps.ratePerMinute);
  const now = deps.now ?? (() => new Date());

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path === '/health' || path === '/health/ready' || path === '/metrics') return next();
    const started = Date.now();
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      typeof incoming === 'string' && CORRELATION.test(incoming) ? incoming : randomUUID();
    const match = ROUTE.exec(path);
    const provider = match?.[1] ?? 'none';
    let eventId: string | null = null;

    const reply = (status: number, result: Result, body: Record<string, unknown>, extra = {}) => {
      deps.webhooks.inc({ provider: deps.verifiers.has(provider) ? provider : 'other', result });
      const payload = JSON.stringify({ ...body, correlationId });
      res.writeHead(status, {
        'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Correlation-Id': correlationId,
        'Cache-Control': 'no-store',
        ...extra,
      });
      res.end(payload);
      deps.logger.info({
        msg: 'payment-gateway.webhook',
        provider,
        eventId,
        status,
        result,
        durationMs: Date.now() - started,
        correlationId,
      });
    };
    const problem = (status: number, result: Result, code: string, title: string, extra = {}) =>
      reply(
        status,
        result,
        { type: `https://tontinemoney.local/errors/${code.toLowerCase()}`, title, status, code },
        extra,
      );

    if (!match || req.method !== 'POST')
      return problem(404, 'not_found', 'NOT_FOUND', 'Ressource introuvable');

    const rl = limiter.hit(ipOf(req, deps.trustProxyHops));
    if (!rl.allowed)
      return problem(429, 'rate_limited', 'RATE_LIMITED', 'Trop de requêtes', {
        'Retry-After': String(rl.retryAfterSeconds),
      });

    const verifier = deps.verifiers.get(provider);
    if (!verifier)
      return problem(404, 'unknown_provider', 'NOT_FOUND', 'Prestataire inconnu ou désactivé');

    if (Number(req.headers['content-length'] ?? 0) > deps.maxBodyBytes)
      return problem(413, 'too_large', 'PAYLOAD_TOO_LARGE', 'Requête trop volumineuse');
    const raw = await readBody(req, deps.maxBodyBytes);
    if (!raw) return problem(413, 'too_large', 'PAYLOAD_TOO_LARGE', 'Requête trop volumineuse');

    let notification;
    try {
      notification = verifier.verify(req.headers, raw, now());
    } catch (e) {
      if (!(e instanceof WebhookRejected)) throw e;
      if (e.reason === 'PAYLOAD')
        return problem(
          400,
          'rejected_payload',
          'VALIDATION_FAILED',
          'Webhook illisible ou invalide',
        );
      return problem(
        401,
        e.reason === 'TIMESTAMP' ? 'rejected_timestamp' : 'rejected_signature',
        'INVALID_SIGNATURE',
        e.reason === 'TIMESTAMP' ? 'Horodatage hors tolérance (anti-rejeu)' : 'Signature invalide',
      );
    }
    eventId = notification.providerEventId;

    const sha = createHash('sha256').update(raw).digest('hex');
    const claim = await deps.receipts.claim(notification, sha, now());
    if (claim.kind === 'conflict') {
      deps.logger.warn({
        msg: 'payment-gateway.event_id_reused',
        provider,
        eventId,
        correlationId,
      });
      return problem(
        409,
        'conflict',
        'CONFLICT',
        'Identifiant d’événement déjà utilisé avec un autre contenu',
      );
    }
    if (claim.kind === 'in_progress')
      return problem(503, 'in_progress', 'IN_PROGRESS', 'Transmission en cours, réessayer', {
        'Retry-After': '5',
      });
    if (claim.kind === 'duplicate')
      return reply(200, 'duplicate', {
        received: true,
        duplicate: true,
        outcome: claim.receipt.outcome,
      });

    const sent = await deps.forwarder.forward(notification, correlationId);
    if (sent.ok) {
      await deps.receipts.forwarded(claim.receipt.id, sent.outcome, sent.attempts, now());
      return reply(200, 'forwarded', { received: true, duplicate: false, outcome: sent.outcome });
    }
    await deps.receipts.failed(claim.receipt.id, sent.error, sent.attempts);
    if (sent.retryable)
      return problem(
        503,
        'forward_failed',
        'UPSTREAM_UNAVAILABLE',
        'Service de paiement indisponible, réessayer',
        {
          'Retry-After': '30',
        },
      );
    // Refus définitif du Payment Service : acquitté pour que le PSP cesse ses envois ; tracé.
    deps.logger.error({
      msg: 'payment-gateway.refused',
      provider,
      eventId,
      error: sent.error,
      correlationId,
    });
    return reply(200, 'refused_by_service', {
      received: true,
      duplicate: false,
      outcome: 'REFUSED',
    });
  };
}
