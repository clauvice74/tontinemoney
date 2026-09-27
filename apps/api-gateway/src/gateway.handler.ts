import { randomUUID } from 'node:crypto';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import https from 'node:https';
import { Transform, type TransformCallback } from 'node:stream';
import { type Logger } from 'pino';
import { type AuthResult, type TokenVerifier, edgeRuleFor } from './auth';
import { CircuitBreaker } from './circuit-breaker';
import { type GatewayConfig } from './config';
import { type GatewayMetrics } from './metrics';
import { type GatewayErrorCode, sendProblem } from './problem';
import { FixedWindowRateLimiter } from './rate-limiter';
import { type RouteTable, clientIp } from './routes';

/** En-têtes propres à une connexion : jamais retransmis (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);
/** En-têtes d'identité ou de routage que seul le gateway peut positionner. */
const SPOOFABLE = /^(x-forwarded-|x-real-ip$|forwarded$|x-user-|x-session-id$|x-gateway)/;
/** Le gateway porte la politique CORS : celle des services amont est retirée. */
const UPSTREAM_ONLY = /^(access-control-|x-powered-by$)/;
const CORRELATION = /^[A-Za-z0-9-]{8,64}$/;

export interface GatewayDeps {
  config: GatewayConfig;
  routes: RouteTable;
  verifier: TokenVerifier;
  metrics: GatewayMetrics;
  logger: Logger;
}

class BodyLimit extends Transform {
  seen = 0;
  constructor(private readonly max: number) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.seen += chunk.length;
    if (this.seen > this.max) cb(new Error('BODY_TOO_LARGE'));
    else cb(null, chunk);
  }
}

/**
 * Pipeline du gateway : corrélation → routage → rate limiting → taille → JWT → règle de bord →
 * disjoncteur → proxy en flux. Aucune règle métier : les services restent l'autorité.
 */
export function createGatewayHandler(deps: GatewayDeps) {
  const { config, routes, verifier, metrics, logger } = deps;
  const general = new FixedWindowRateLimiter(config.GATEWAY_RATE_LIMIT_PER_MINUTE);
  const auth = new FixedWindowRateLimiter(config.GATEWAY_AUTH_RATE_LIMIT_PER_MINUTE);
  const breakers = new Map<string, CircuitBreaker>();
  const breakerFor = (upstream: string) => {
    let b = breakers.get(upstream);
    if (!b) {
      b = new CircuitBreaker(config.GATEWAY_CIRCUIT_FAILURES, config.GATEWAY_CIRCUIT_RESET_MS);
      breakers.set(upstream, b);
    }
    return b;
  };

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://gateway.local');
    const path = url.pathname;
    if (path === '/health' || path === '/health/ready' || path === '/metrics') return next();

    const started = process.hrtime.bigint();
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      typeof incoming === 'string' && CORRELATION.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    const ip = clientIp(
      req.socket.remoteAddress,
      req.headers['x-forwarded-for'],
      config.GATEWAY_TRUST_PROXY_HOPS,
    );
    let label = 'none';
    let userId: string | null = null;
    let upstreamName: string | null = null;

    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.requests.inc({ route: label, method: req.method ?? '', status: res.statusCode });
      metrics.duration.observe({ route: label, method: req.method ?? '' }, seconds);
      logger.info({
        msg: 'gateway.request',
        method: req.method,
        path,
        route: label,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
        correlationId,
        userId,
        upstream: upstreamName,
      });
    });

    const reject = (code: GatewayErrorCode, headers?: Record<string, string>, detail?: string) => {
      metrics.rejected.inc({ reason: code });
      sendProblem(res, code, correlationId, path, {
        ...(headers ? { headers } : {}),
        ...(detail ? { detail } : {}),
      });
    };

    // Chemin brut (avant normalisation par URL) : segments « . » / « .. », encodés ou non, et
    // séparateurs encodés refusés — la règle de bord et le routage portent sur le chemin reçu.
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
    if (
      /(^|\/)(\.|%2e){1,2}(\/|$)|%2f|%5c|\\/i.test(rawPath) ||
      // caractère non réservé encodé (lettre, chiffre, - . _ ~) : jamais nécessaire, sert à
      // contourner les règles de préfixe (ex. /api/v1/%61dmin)
      /%(3[0-9]|4[1-9a-f]|5[0-9a]|6[1-9a-f]|7[0-9a]|2d|2e|5f|7e)/i.test(rawPath)
    )
      return reject('NOT_FOUND');
    const route = routes.resolve(path);
    if (!route) return reject('NOT_FOUND');
    label = route.label;

    const limited = general.hit(ip);
    if (!limited.allowed)
      return reject('RATE_LIMITED', { 'Retry-After': String(limited.retryAfterSeconds) });
    if (path.startsWith('/api/v1/auth/')) {
      const a = auth.hit(ip);
      if (!a.allowed) return reject('RATE_LIMITED', { 'Retry-After': String(a.retryAfterSeconds) });
    }

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > config.GATEWAY_MAX_BODY_BYTES) return reject('PAYLOAD_TOO_LARGE');

    let who: AuthResult;
    try {
      who = await verifier.check(req.headers.authorization);
    } catch {
      who = { kind: 'invalid' };
    }
    if (who.kind === 'invalid')
      return reject('UNAUTHENTICATED', { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    if (who.kind === 'authenticated') userId = who.identity.userId;
    const rule = edgeRuleFor(config.GATEWAY_EDGE_RULES, path);
    if (rule) {
      if (who.kind !== 'authenticated')
        return reject('UNAUTHENTICATED', { 'WWW-Authenticate': 'Bearer' });
      if (!rule.roles.includes(who.identity.role)) return reject('FORBIDDEN');
    }

    const breaker = breakerFor(route.upstream);
    if (!breaker.tryAcquire()) {
      metrics.circuit.set({ upstream: route.upstream }, 1);
      return reject('UPSTREAM_UNAVAILABLE', {
        'Retry-After': String(Math.ceil(config.GATEWAY_CIRCUIT_RESET_MS / 1000)),
      });
    }
    upstreamName = route.upstream;

    const target = new URL(`${url.pathname}${url.search}`, route.upstream);
    const headers: IncomingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers))
      if (!HOP_BY_HOP.has(k) && !SPOOFABLE.test(k) && v !== undefined) headers[k] = v;
    headers['x-forwarded-for'] = ip;
    headers['x-forwarded-proto'] =
      config.GATEWAY_TRUST_PROXY_HOPS > 0 && req.headers['x-forwarded-proto'] === 'https'
        ? 'https'
        : 'http';
    if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;
    headers['x-correlation-id'] = correlationId;
    // Contexte informatif : chaque service revérifie le JWT (confiance zéro).
    if (who.kind === 'authenticated') {
      headers['x-user-id'] = who.identity.userId;
      headers['x-user-role'] = who.identity.role;
      headers['x-session-id'] = who.identity.sessionId;
    }

    const client = target.protocol === 'https:' ? https : http;
    let settled = false;
    const fail = (code: GatewayErrorCode) => {
      if (settled) return;
      settled = true;
      if (code !== 'PAYLOAD_TOO_LARGE') {
        breaker.failure();
        metrics.circuit.set({ upstream: route.upstream }, breaker.current === 'CLOSED' ? 0 : 1);
      }
      reject(code);
    };

    const upstreamReq = client.request(target, { method: req.method, headers }, (up) => {
      settled = true;
      const status = up.statusCode ?? 502;
      if (status === 502 || status === 503 || status === 504) breaker.failure();
      else breaker.success();
      metrics.circuit.set({ upstream: route.upstream }, breaker.current === 'CLOSED' ? 0 : 1);
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(up.headers))
        if (v !== undefined && !HOP_BY_HOP.has(k) && !UPSTREAM_ONLY.test(k)) out[k] = v;
      out['x-correlation-id'] = correlationId;
      res.writeHead(status, out);
      up.pipe(res);
    });
    upstreamReq.setTimeout(config.GATEWAY_UPSTREAM_TIMEOUT_MS, () => {
      fail('UPSTREAM_TIMEOUT');
      upstreamReq.destroy();
    });
    upstreamReq.on('error', (e: NodeJS.ErrnoException) => {
      if (e.message === 'BODY_TOO_LARGE') return fail('PAYLOAD_TOO_LARGE');
      fail(e.code === 'ECONNREFUSED' ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_ERROR');
    });
    res.on('close', () => {
      if (!res.writableFinished) upstreamReq.destroy();
    });

    const limit = new BodyLimit(config.GATEWAY_MAX_BODY_BYTES);
    limit.on('error', (e) => upstreamReq.destroy(e));
    req.pipe(limit).pipe(upstreamReq);
  };
}
