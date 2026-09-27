import { createHmac, randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { verifyInternalRequest } from '@tontine/auth';
import { type PrismaClient, createPrismaClient } from '@tontine/database';
import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPaymentGateway } from './bootstrap';
import { loadPaymentGatewayConfig } from './config';

const PSP_SECRET = 'test-webhook-secret-0123456789';
const INTERNAL_SECRET = 'test-internal-secret-0123456789abcdef';
const DB =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://tontine:tontine@localhost:5432/tontinemoney_test';

let prisma: PrismaClient;
let service: Server;
let serviceUrl: string;
/** Appels reçus par le faux Payment Service (signature interne vérifiée). */
let received: Array<{ body: Record<string, unknown>; signed: boolean; correlation: unknown }> = [];
let respond: (res: ServerResponse) => void = (res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"received":true,"result":"PROCESSED"}');
};

function webhook(
  body: Record<string, unknown>,
  opts: { secret?: string; at?: Date; signature?: string } = {},
) {
  const raw = JSON.stringify(body);
  const ts = Math.floor((opts.at ?? new Date()).getTime() / 1000);
  const sig =
    opts.signature ??
    createHmac('sha256', opts.secret ?? PSP_SECRET)
      .update(`${ts}.${raw}`)
      .digest('hex');
  return { raw, headers: { 'x-psp-signature': sig, 'x-psp-timestamp': String(ts) } };
}

const event = (over: Record<string, unknown> = {}) => ({
  id: `evt_${randomUUID()}`,
  reference: `sim_${randomUUID().slice(0, 8)}`,
  merchantReference: randomUUID(),
  status: 'SUCCESS',
  amountMinor: '25000',
  currency: 'XAF',
  failureReason: null,
  ...over,
});

let app: NestExpressApplication;
async function gateway(env: Record<string, string> = {}) {
  app = await createPaymentGateway({
    config: loadPaymentGatewayConfig({
      NODE_ENV: 'test',
      DATABASE_URL: DB,
      PAYMENT_SERVICE_URL: serviceUrl,
      INTERNAL_SERVICE_SECRET: INTERNAL_SECRET,
      PSP_WEBHOOK_SECRET: PSP_SECRET,
      ...env,
    }),
    prisma,
    logger: pino({ level: 'silent' }),
    sleep: async () => undefined,
  });
  await app.init();
  return request(app.getHttpServer());
}

function post(
  api: Awaited<ReturnType<typeof gateway>>,
  provider: string,
  w: { raw: string; headers: Record<string, string> },
) {
  return api
    .post(`/api/v1/webhooks/payments/${provider}`)
    .set('Content-Type', 'application/json')
    .set(w.headers)
    .send(w.raw);
}

beforeAll(async () => {
  prisma = createPrismaClient({ url: DB, poolSize: 2 });
  service = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return respond(res);
      const check = verifyInternalRequest(INTERNAL_SECRET, req.headers, raw, {
        allowedCallers: ['payment-gateway'],
      });
      received.push({
        body: JSON.parse(raw) as Record<string, unknown>,
        signed: check.ok,
        correlation: req.headers['x-correlation-id'],
      });
      respond(res);
    });
  });
  await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
  serviceUrl = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => service.close(r));
  await prisma.$disconnect();
});
beforeEach(async () => {
  received = [];
  respond = (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"received":true,"result":"PROCESSED"}');
  };
  await prisma.paymentGatewayReceipt.deleteMany();
});
afterEach(async () => {
  await app?.close();
});

describe('webhook valide', () => {
  it('normalisé, transmis au Payment Service par un appel interne signé, journalisé', async () => {
    const api = await gateway();
    const e = event();
    const res = await post(api, 'simulated', webhook(e)).set('X-Correlation-Id', 'corr-12345678');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, duplicate: false, outcome: 'PROCESSED' });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ signed: true, correlation: 'corr-12345678' });
    expect(received[0]?.body).toEqual({
      provider: 'simulated',
      providerEventId: e.id,
      providerReference: e.reference,
      merchantReference: e.merchantReference,
      status: 'SUCCESS',
      amountMinor: '25000',
      currency: 'XAF',
      failureReason: null,
      occurredAt: expect.any(String),
    });
    const r = await prisma.paymentGatewayReceipt.findFirstOrThrow({
      where: { providerEventId: e.id },
    });
    expect(r).toMatchObject({
      state: 'FORWARDED',
      outcome: 'PROCESSED',
      attempts: 1,
      amountMinor: 25000n,
    });
  });

  it('double webhook : second acquitté comme doublon, jamais retransmis', async () => {
    const api = await gateway();
    const w = webhook(event());
    expect((await post(api, 'simulated', w)).status).toBe(200);
    const again = await post(api, 'simulated', w);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, outcome: 'PROCESSED' });
    expect(received).toHaveLength(1);
  });

  it('webhooks concurrents identiques : une seule transmission ; les autres 200 doublon ou 503 à réessayer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    respond = (res) => {
      void gate.then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"received":true,"result":"PROCESSED"}');
      });
    };
    const api = await gateway();
    const w = webhook(event());
    const pending = [1, 2, 3, 4].map(() => post(api, 'simulated', w).then((r) => r));
    await new Promise((r) => setTimeout(r, 200));
    release();
    const results = await Promise.all(pending);
    expect(received).toHaveLength(1);
    expect(results.filter((r) => r.status === 200 && !r.body.duplicate)).toHaveLength(1);
    expect(results.every((r) => r.status === 200 || r.status === 503)).toBe(true);
    // renvoi du PSP après la transmission : doublon acquitté
    const later = await post(api, 'simulated', w);
    expect(later.body).toMatchObject({ duplicate: true, outcome: 'PROCESSED' });
    expect(received).toHaveLength(1);
  });

  it('bail expiré (gateway arrêté pendant une transmission) : le renvoi du PSP reprend la transmission', async () => {
    const api = await gateway();
    const e = event();
    const w = webhook(e);
    await prisma.paymentGatewayReceipt.create({
      data: {
        provider: 'simulated',
        providerEventId: e.id,
        bodySha256: (await import('node:crypto')).createHash('sha256').update(w.raw).digest('hex'),
        merchantReference: e.merchantReference,
        status: 'SUCCESS',
        amountMinor: 25000n,
        currency: 'XAF',
        state: 'RECEIVED',
        claimedAt: new Date(Date.now() - 3_600_000),
      },
    });
    const res = await post(api, 'simulated', w);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('PROCESSED');
    expect(received).toHaveLength(1);
  });

  it('même identifiant d’événement, contenu différent → 409, rien transmis', async () => {
    const api = await gateway();
    const e = event();
    await post(api, 'simulated', webhook(e));
    const tampered = await post(api, 'simulated', webhook({ ...e, amountMinor: '99999999' }));
    expect(tampered.status).toBe(409);
    expect(received).toHaveLength(1);
  });
});

describe('webhooks refusés', () => {
  it('signature invalide, autre secret, horodatage hors tolérance → 401 sans transmission ni journal', async () => {
    const api = await gateway();
    const e = event();
    for (const w of [
      webhook(e, { signature: 'a'.repeat(64) }),
      webhook(e, { secret: 'another-secret-0123456789' }),
      webhook(e, { at: new Date(Date.now() - 10 * 60_000) }),
      { raw: JSON.stringify(e), headers: {} as Record<string, string> },
    ]) {
      const res = await post(api, 'simulated', w);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_SIGNATURE');
    }
    expect(received).toHaveLength(0);
    expect(await prisma.paymentGatewayReceipt.count()).toBe(0);
  });

  it('montant, devise, statut ou référence invalides → 400', async () => {
    const api = await gateway();
    for (const over of [
      { amountMinor: '0' },
      { amountMinor: '12.5' },
      { amountMinor: '-100' },
      { currency: 'ZZZ' },
      { currency: 'xa' },
      { status: 'MAYBE' },
      { merchantReference: 'not-a-uuid' },
    ]) {
      const res = await post(api, 'simulated', webhook(event(over)));
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    expect(received).toHaveLength(0);
  });

  it('prestataire inconnu ou désactivé → 404 ; autre méthode ou chemin → 404', async () => {
    const api = await gateway();
    for (const p of ['unknown', 'flutterwave', 'paystack']) {
      const res = await post(api, p, webhook(event()));
      expect(res.status, p).toBe(404);
    }
    expect((await api.get('/api/v1/webhooks/payments/simulated')).status).toBe(404);
    expect((await api.post('/api/v1/tontines')).status).toBe(404);
  });

  it('corps trop volumineux → 413', async () => {
    const api = await gateway({ PAYMENT_GATEWAY_MAX_BODY_BYTES: '1024' });
    const res = await post(api, 'simulated', webhook(event({ failureReason: 'x'.repeat(2000) })));
    expect(res.status).toBe(413);
  });

  it('rate limiting par IP → 429', async () => {
    const api = await gateway({ PAYMENT_GATEWAY_RATE_LIMIT_PER_MINUTE: '2' });
    await post(api, 'simulated', webhook(event()));
    await post(api, 'simulated', webhook(event()));
    const res = await post(api, 'simulated', webhook(event()));
    expect(res.status).toBe(429);
  });
});

describe('Payment Service indisponible ou en refus', () => {
  it('panne : 503 au PSP après réessais, puis retransmission au renvoi du PSP', async () => {
    let calls = 0;
    respond = (res) => {
      calls++;
      res.writeHead(503).end();
    };
    const api = await gateway({ PAYMENT_GATEWAY_FORWARD_ATTEMPTS: '3' });
    const w = webhook(event());
    const first = await post(api, 'simulated', w);
    expect(first.status).toBe(503);
    expect(first.headers['retry-after']).toBeDefined();
    expect(calls).toBe(3);
    expect(await prisma.paymentGatewayReceipt.findFirst()).toMatchObject({
      state: 'FORWARD_FAILED',
      attempts: 3,
    });
    respond = (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"received":true,"result":"PROCESSED"}');
    };
    const retry = await post(api, 'simulated', w);
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe('PROCESSED');
    expect(await prisma.paymentGatewayReceipt.findFirst()).toMatchObject({
      state: 'FORWARDED',
      attempts: 4,
    });
  });

  it('service arrêté (connexion refusée) → 503', async () => {
    const api = await gateway({ PAYMENT_SERVICE_URL: 'http://127.0.0.1:1' });
    expect((await post(api, 'simulated', webhook(event()))).status).toBe(503);
  });

  it('refus définitif (400) : acquitté au PSP, tracé, pas de réessai en boucle', async () => {
    let calls = 0;
    respond = (res) => {
      calls++;
      res
        .writeHead(400, { 'Content-Type': 'application/json' })
        .end('{"code":"VALIDATION_FAILED"}');
    };
    const api = await gateway();
    const res = await post(api, 'simulated', webhook(event()));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('REFUSED');
    expect(calls).toBe(1);
    expect((await prisma.paymentGatewayReceipt.findFirst())?.lastError).toContain('HTTP 400');
  });

  it('secret interne refusé (401) : 503 pour que le PSP réessaie après correction', async () => {
    respond = (res) => {
      res.writeHead(401).end();
    };
    const api = await gateway();
    expect((await post(api, 'simulated', webhook(event()))).status).toBe(503);
  });
});

describe('santé et configuration', () => {
  it('/health, /health/ready (base + Payment Service), /metrics', async () => {
    respond = (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
    };
    const api = await gateway();
    expect((await api.get('/health')).body).toEqual({ status: 'ok', service: 'payment-gateway' });
    expect((await api.get('/health/ready')).status).toBe(200);
    await post(api, 'simulated', webhook(event()));
    expect((await api.get('/metrics')).text).toContain('payment_gateway_webhooks_total');
  });
});
