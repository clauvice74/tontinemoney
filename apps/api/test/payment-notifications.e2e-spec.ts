import { randomUUID } from 'node:crypto';
import { signInternalRequest } from '@tontine/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, type TestUser, bearer, createTestContext } from './support/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const PATH = '/api/v1/internal/payments/notifications';

/** Dépôt Mobile Money en attente de confirmation du PSP. */
async function processingDeposit(user: TestUser, amount = '25000') {
  const res = await ctx.http
    .post('/api/v1/me/wallet/deposits')
    .set(bearer(await ctx.token(user)))
    .set('Idempotency-Key', randomUUID())
    .send({ amount, currency: 'XAF', method: 'MOBILE_MONEY', phone: '+237677001122' });
  expect(res.status).toBe(201);
  return res.body as { id: string; providerReference: string };
}

function notification(
  p: { id: string; providerReference: string },
  over: Record<string, unknown> = {},
) {
  return {
    provider: 'simulated',
    providerEventId: `evt_${randomUUID()}`,
    providerReference: p.providerReference,
    merchantReference: p.id,
    status: 'SUCCESS',
    amountMinor: '25000',
    currency: 'XAF',
    failureReason: null,
    occurredAt: ctx.clock.now().toISOString(),
    ...over,
  };
}

function send(body: unknown, opts: { secret?: string; caller?: string; at?: Date } = {}) {
  const raw = JSON.stringify(body);
  return ctx.http
    .post(PATH)
    .set('Content-Type', 'application/json')
    .set(
      signInternalRequest(
        opts.secret ?? ctx.config.INTERNAL_SERVICE_SECRET,
        opts.caller ?? 'payment-gateway',
        raw,
        opts.at ?? ctx.clock.now(),
      ),
    )
    .send(raw);
}

describe('Notifications internes du Payment Gateway', () => {
  it('notification signée : paiement COMPLETED, wallet crédité ; doublon sans second crédit', async () => {
    const user = await ctx.createUser();
    const p = await processingDeposit(user);
    const n = notification(p);
    const res = await send(n);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, result: 'PROCESSED' });
    await ctx.drain();
    await ctx.drain();
    expect(await ctx.balance(user.id)).toEqual({ balance: 25_000n, blocked: 0n });
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'COMPLETED',
    );
    const again = await send(n);
    expect(again.body.result).toBe('DUPLICATE');
    await ctx.drain();
    expect(await ctx.balance(user.id)).toEqual({ balance: 25_000n, blocked: 0n });
  });

  it('montant ou devise divergents : jamais de crédit (AMOUNT_MISMATCH, audit)', async () => {
    const user = await ctx.createUser();
    const p = await processingDeposit(user);
    const res = await send(notification(p, { amountMinor: '2500000' }));
    expect(res.body.result).toBe('AMOUNT_MISMATCH');
    await ctx.drain();
    expect(await ctx.balance(user.id)).toEqual({ balance: 0n, blocked: 0n });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'payment.amount_mismatch', resourceId: p.id },
      }),
    ).toBe(1);
  });

  it('échec signalé par le PSP : paiement FAILED, aucun crédit', async () => {
    const user = await ctx.createUser();
    const p = await processingDeposit(user);
    const res = await send(
      notification(p, { status: 'FAILED', failureReason: 'Solde opérateur insuffisant' }),
    );
    expect(res.body.result).toBe('PROCESSED');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'FAILED',
    );
    expect(await ctx.balance(user.id)).toEqual({ balance: 0n, blocked: 0n });
  });

  it('paiement inconnu, référence PSP différente : aucun effet', async () => {
    const user = await ctx.createUser();
    const p = await processingDeposit(user);
    expect(
      (await send(notification({ id: randomUUID(), providerReference: 'x-1' }))).body.result,
    ).toBe('UNKNOWN_PAYMENT');
    expect((await send(notification(p, { providerReference: 'sim_autre' }))).body.result).toBe(
      'IGNORED',
    );
    expect(await ctx.balance(user.id)).toEqual({ balance: 0n, blocked: 0n });
  });

  it('appel non authentifié : sans signature, mauvais secret, appelant inconnu, horodatage périmé → 401 journalisé', async () => {
    const user = await ctx.createUser();
    const p = await processingDeposit(user);
    const n = notification(p);
    const unsigned = await ctx.http.post(PATH).set('Content-Type', 'application/json').send(n);
    expect(unsigned.status).toBe(401);
    for (const opts of [
      { secret: 'wrong-internal-secret-0123456789abcdef' },
      { caller: 'api-gateway' },
      { at: new Date(ctx.clock.now().getTime() - 5 * 60_000) },
    ]) {
      expect((await send(n, opts)).status, JSON.stringify(opts)).toBe(401);
    }
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'internal.request.rejected' } }),
    ).toBe(4);
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'PROCESSING',
    );
  });

  it('corps signé mais invalide (schéma strict) ou prestataire désactivé → 400 / 404', async () => {
    const user = await ctx.createUser();
    const p = await processingDeposit(user);
    expect((await send({ ...notification(p), extra: 'x' })).status).toBe(400);
    expect((await send(notification(p, { amountMinor: '12.5' }))).status).toBe(400);
    expect((await send(notification(p, { currency: 'ZZZ' }))).status).toBe(400);
    expect((await send(notification(p, { provider: 'flutterwave' }))).status).toBe(404);
  });

  it('route interne absente de la documentation OpenAPI publique', async () => {
    const doc = await ctx.http.get('/api/docs-json');
    if (doc.status === 200) expect(JSON.stringify(doc.body.paths)).not.toContain('/internal/');
  });
});
