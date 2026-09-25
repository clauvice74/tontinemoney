import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ComplianceService } from '@tontine/compliance';
import { ProviderDisabledError, ProviderRegistry, signWebhook } from '@tontine/payments';
import { type TestContext, type TestUser, bearer, createTestContext } from './support/test-app';

let ctx: TestContext;
let registry: ProviderRegistry;

beforeAll(async () => {
  ctx = await createTestContext();
  registry = ctx.app.get(ProviderRegistry);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  for (const p of registry.allSimulated()) {
    p.setAvailability(true);
    registry.breaker(p.name).reset();
  }
});

async function deposit(token: string, body: Record<string, unknown>, key: string = randomUUID()) {
  return ctx.http
    .post('/api/v1/me/wallet/deposits')
    .set(bearer(token))
    .set('Idempotency-Key', key)
    .send(body);
}
const mm = (amount = '25000', phone = '+237677001122') => ({
  amount,
  currency: 'XAF',
  method: 'MOBILE_MONEY',
  phone,
});

async function confirmUssd(
  token: string,
  reference: string,
  outcome = 'SUCCESS',
  deliverWebhook = true,
) {
  return ctx.http
    .post(`/api/v1/psp-sim/mobile-money/${reference}/confirm`)
    .set(bearer(token))
    .send({ outcome, deliverWebhook });
}

function webhook(
  body: Record<string, unknown>,
  opts: { at?: Date; secret?: string; signature?: string } = {},
) {
  const raw = JSON.stringify(body);
  const ts = Math.floor((opts.at ?? ctx.clock.now()).getTime() / 1000);
  const sig = opts.signature ?? signWebhook(opts.secret ?? ctx.config.PSP_WEBHOOK_SECRET, ts, raw);
  return ctx.http
    .post('/api/v1/payments/webhooks/simulated')
    .set('content-type', 'application/json')
    .set('x-psp-signature', sig)
    .set('x-psp-timestamp', String(ts))
    .send(raw);
}

async function processingDeposit(user: TestUser, amount = '25000') {
  const token = await ctx.token(user);
  const res = await deposit(token, mm(amount));
  expect(res.status).toBe(201);
  return { token, payment: res.body as { id: string; providerReference: string; status: string } };
}

describe('US-7.1 — dépôt Mobile Money', () => {
  it('nominal : USSD simulé → webhook signé → COMPLETED → wallet crédité (US-5.3) + notification', async () => {
    const user = await ctx.createUser();
    const token = await ctx.token(user);
    const res = await deposit(token, mm());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'DEPOSIT',
      method: 'MOBILE_MONEY',
      status: 'PROCESSING',
      provider: 'simulated',
      destination: expect.stringContaining('**'),
      amount: { amountMinor: '25000' },
    });
    expect(res.body.instructions).toContain('USSD');
    const confirm = await confirmUssd(token, res.body.providerReference);
    expect(confirm.body).toMatchObject({ delivered: true });
    await ctx.drain();
    await ctx.drain();
    expect((await ctx.balance(user.id)).balance).toBe(25_000n);
    const p = await ctx.http.get(`/api/v1/me/payments/${res.body.id}`).set(bearer(token));
    expect(p.body.status).toBe('COMPLETED');
    expect(p.body.transactionId).toBeTruthy();
    expect(p.body.history.map((h: { to: string }) => h.to)).toEqual([
      'PENDING',
      'PROCESSING',
      'COMPLETED',
    ]);
    const mov = await ctx.http.get('/api/v1/me/wallet/movements').set(bearer(token));
    expect(mov.body.data[0]).toMatchObject({ type: 'CREDIT', context: 'DEPOSIT' });
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'payment.completed' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('refus USSD : FAILED, aucun crédit', async () => {
    const user = await ctx.createUser();
    const { token, payment } = await processingDeposit(user);
    await confirmUssd(token, payment.providerReference, 'FAILURE');
    await ctx.drain();
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'FAILED',
    );
    expect((await ctx.balance(user.id)).balance).toBe(0n);
  });

  it('Idempotency-Key : double soumission → un seul paiement et une seule opération PSP', async () => {
    const user = await ctx.createUser();
    const token = await ctx.token(user);
    const key = randomUUID();
    const r1 = await deposit(token, mm(), key);
    const r2 = await deposit(token, mm(), key);
    expect(r2.body.id).toBe(r1.body.id);
    expect(await ctx.prisma.payment.count()).toBe(1);
    expect(await ctx.prisma.pspSimOperation.count()).toBe(1);
  });

  it('PSP principal en panne : rejeu 3× puis repli sur le PSP de secours ; disjoncteur ouvert', async () => {
    registry.simulated('simulated').setAvailability(false);
    const user = await ctx.createUser();
    const token = await ctx.token(user);
    const r1 = await deposit(token, mm());
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ provider: 'simulated-backup', fallbackUsed: true });
    await deposit(token, mm('1000'));
    expect(registry.breaker('simulated').currentState).toBe('OPEN');
    // le secours traite aussi le webhook
    await confirmUssd(token, r1.body.providerReference);
    await ctx.drain();
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: r1.body.id } })).status).toBe(
      'COMPLETED',
    );
  });

  it('tous les PSP indisponibles : 503 PROVIDER_UNAVAILABLE, paiement FAILED', async () => {
    const user = await ctx.createUser();
    const res = await deposit(await ctx.token(user), mm('1000', '+237677000003'));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PROVIDER_UNAVAILABLE');
    expect((await ctx.prisma.payment.findFirstOrThrow()).status).toBe('FAILED');
  });

  it('conformité : plafond de wallet dépassé → refus avant tout appel PSP', async () => {
    await ctx.prisma.complianceRule.create({
      data: {
        code: 'CM-WALLET-CAP',
        countryCode: 'CM',
        ruleType: 'WALLET_LIMIT',
        operationTypes: ['DEPOSIT'],
        params: { limitMinor: '10000' },
        active: true,
      },
    });
    await ctx.app.get(ComplianceService).invalidate('CM');
    const user = await ctx.createUser();
    const res = await deposit(await ctx.token(user), mm('20000'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COMPLIANCE_VIOLATION');
    expect(await ctx.prisma.pspSimOperation.count()).toBe(0);
  });

  it('devise différente du wallet : CURRENCY_MISMATCH', async () => {
    const user = await ctx.createUser();
    const res = await deposit(await ctx.token(user), {
      amount: '10',
      currency: 'EUR',
      method: 'CARD',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CURRENCY_MISMATCH');
  });
});

describe('US-7.2 — dépôt par carte (3-D Secure simulé)', () => {
  it('redirection vers la page PSP, aucune donnée carte, validation → crédit', async () => {
    const user = await ctx.createUser();
    const token = await ctx.token(user);
    const res = await deposit(token, { amount: '15000', currency: 'XAF', method: 'CARD' });
    expect(res.status).toBe(201);
    expect(res.body.redirectUrl).toContain(
      `/api/v1/psp-sim/checkout/${res.body.providerReference}`,
    );
    const page = await ctx.http.get(`/api/v1/psp-sim/checkout/${res.body.providerReference}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('simulation');
    expect(page.text).not.toMatch(/card.?number|cvv/i);
    const ok = await ctx.http
      .post(`/api/v1/psp-sim/checkout/${res.body.providerReference}`)
      .send({ outcome: 'SUCCESS' });
    expect(ok.status).toBe(200);
    await ctx.drain();
    await ctx.drain();
    expect((await ctx.balance(user.id)).balance).toBe(15_000n);
    // aucune colonne de carte : seul un masque de destination (null pour la carte)
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(p.destinationEnc).toBeNull();
  });
});

describe('US-7.4 — webhooks et machine à états', () => {
  it('double webhook (même événement) : traité une seule fois, un seul crédit', async () => {
    const user = await ctx.createUser();
    const { payment } = await processingDeposit(user);
    const body = {
      id: `evt_${randomUUID()}`,
      reference: payment.providerReference,
      merchantReference: payment.id,
      status: 'SUCCESS',
      amountMinor: '25000',
      currency: 'XAF',
    };
    const w1 = await webhook(body);
    const w2 = await webhook(body);
    expect(w1.body.result).toBe('PROCESSED');
    expect(w2.body.result).toBe('DUPLICATE');
    // un autre identifiant d'événement pour le même paiement : état terminal, sans effet
    const w3 = await webhook({ ...body, id: `evt_${randomUUID()}` });
    expect(w3.body.result).toBe('DUPLICATE');
    await ctx.drain();
    await ctx.drain();
    expect((await ctx.balance(user.id)).balance).toBe(25_000n);
    expect(await ctx.prisma.transaction.count({ where: { type: 'DEPOSIT' } })).toBe(1);
  });

  it('signature invalide, horodatage hors tolérance, corps altéré : 401', async () => {
    const user = await ctx.createUser();
    const { payment } = await processingDeposit(user);
    const body = {
      id: `evt_${randomUUID()}`,
      reference: payment.providerReference,
      merchantReference: payment.id,
      status: 'SUCCESS',
      amountMinor: '25000',
      currency: 'XAF',
    };
    expect((await webhook(body, { secret: 'mauvais-secret-0123456789' })).status).toBe(401);
    expect(
      (await webhook(body, { at: new Date(ctx.clock.now().getTime() - 10 * 60_000) })).status,
    ).toBe(401);
    const raw = JSON.stringify(body);
    const ts = Math.floor(ctx.clock.now().getTime() / 1000);
    const sig = signWebhook(ctx.config.PSP_WEBHOOK_SECRET, ts, raw);
    const tampered = await ctx.http
      .post('/api/v1/payments/webhooks/simulated')
      .set('content-type', 'application/json')
      .set('x-psp-signature', sig)
      .set('x-psp-timestamp', String(ts))
      .send(raw.replace('25000', '99999'));
    expect(tampered.status).toBe(401);
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'PROCESSING',
    );
    expect(await ctx.prisma.auditLog.count({ where: { action: 'payment.webhook.rejected' } })).toBe(
      3,
    );
  });

  it('montant ou devise divergents : jamais de crédit, alerte', async () => {
    const user = await ctx.createUser();
    const { payment } = await processingDeposit(user);
    const res = await webhook({
      id: `evt_${randomUUID()}`,
      reference: payment.providerReference,
      merchantReference: payment.id,
      status: 'SUCCESS',
      amountMinor: '250000',
      currency: 'XAF',
    });
    expect(res.body.result).toBe('AMOUNT_MISMATCH');
    const res2 = await webhook({
      id: `evt_${randomUUID()}`,
      reference: payment.providerReference,
      merchantReference: payment.id,
      status: 'SUCCESS',
      amountMinor: '25000',
      currency: 'XOF',
    });
    expect(res2.body.result).toBe('AMOUNT_MISMATCH');
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p).toMatchObject({ status: 'PROCESSING', errorCode: 'AMOUNT_MISMATCH' });
    await ctx.drain();
    expect((await ctx.balance(user.id)).balance).toBe(0n);
  });

  it('callback perdu : polling après 5 min puis COMPLETED', async () => {
    const user = await ctx.createUser();
    const { token, payment } = await processingDeposit(user);
    await confirmUssd(token, payment.providerReference, 'SUCCESS', false);
    const early = await ctx.jobs.run('payments.poll', 'test');
    expect(early.summary['checked']).toBe(0);
    ctx.clock.advance(6 * 60_000);
    const run = await ctx.jobs.run('payments.poll', 'test');
    expect(run.summary['resolved']).toBe(1);
    await ctx.drain();
    await ctx.drain();
    expect((await ctx.balance(user.id)).balance).toBe(25_000n);
  });

  it('sans confirmation : backoff du polling puis EXPIRED + notification', async () => {
    const user = await ctx.createUser();
    const { payment } = await processingDeposit(user);
    ctx.clock.advance(6 * 60_000);
    await ctx.jobs.run('payments.poll', 'test');
    const p1 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p1.status).toBe('PROCESSING');
    expect(p1.nextPollAt!.getTime()).toBeGreaterThan(ctx.clock.now().getTime());
    ctx.clock.advance(30 * 60_000);
    const run = await ctx.jobs.run('payments.poll', 'test');
    expect(run.summary['expired']).toBe(1);
    await ctx.drain();
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'EXPIRED',
    );
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: user.id, templateKey: 'payment.expired' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('isolation : un autre membre ne voit ni ne confirme le paiement', async () => {
    const user = await ctx.createUser();
    const { payment } = await processingDeposit(user);
    const other = await ctx.createUser();
    const token = await ctx.token(other);
    expect(
      (await ctx.http.get(`/api/v1/me/payments/${payment.id}`).set(bearer(token))).status,
    ).toBe(404);
    expect((await confirmUssd(token, payment.providerReference)).status).toBe(404);
  });
});

describe('US-7.3 — retrait Mobile Money', () => {
  it('hold puis versement : succès → hold capturé, solde débité', async () => {
    const user = await ctx.createUser();
    await ctx.fund(user.id, 50_000n);
    const token = await ctx.token(user);
    const res = await ctx.http
      .post('/api/v1/me/wallet/withdrawals')
      .set(bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '20000', currency: 'XAF', method: 'MOBILE_MONEY', phone: '+237677001122' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PROCESSING');
    expect(await ctx.balance(user.id)).toEqual({ balance: 50_000n, blocked: 20_000n });
    const admin = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const settle = await ctx.http
      .post(`/api/v1/psp-sim/payouts/${res.body.providerReference}/settle`)
      .set(bearer(await ctx.token(admin)))
      .send({ outcome: 'SUCCESS' });
    expect(settle.status).toBe(200);
    await ctx.drain();
    await ctx.drain();
    expect(await ctx.balance(user.id)).toEqual({ balance: 30_000n, blocked: 0n });
    const hold = await ctx.prisma.walletHold.findFirstOrThrow({
      where: { referenceId: res.body.id },
    });
    expect(hold.status).toBe('CAPTURED');
  });

  it('échec du versement → hold annulé, solde intact', async () => {
    const user = await ctx.createUser();
    await ctx.fund(user.id, 50_000n);
    const token = await ctx.token(user);
    const res = await ctx.http
      .post('/api/v1/me/wallet/withdrawals')
      .set(bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '20000', currency: 'XAF', method: 'MOBILE_MONEY', phone: '+237677000001' });
    await registry.simulated(res.body.provider).settle(res.body.providerReference, 'SUCCESS');
    await ctx.drain();
    expect(
      (await ctx.prisma.payment.findUniqueOrThrow({ where: { id: res.body.id } })).status,
    ).toBe('FAILED');
    expect(await ctx.balance(user.id)).toEqual({ balance: 50_000n, blocked: 0n });
  });

  it('solde insuffisant : 422 et aucun paiement ni hold', async () => {
    const user = await ctx.createUser();
    await ctx.fund(user.id, 5_000n);
    const res = await ctx.http
      .post('/api/v1/me/wallet/withdrawals')
      .set(bearer(await ctx.token(user)))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '20000', currency: 'XAF', method: 'MOBILE_MONEY', phone: '+237677001122' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await ctx.prisma.payment.count({ where: { type: 'WITHDRAWAL' } })).toBe(0);
    expect(await ctx.prisma.walletHold.count()).toBe(0);
  });

  it('retraits concurrents : jamais plus que le solde disponible', async () => {
    const user = await ctx.createUser();
    await ctx.fund(user.id, 50_000n);
    const token = await ctx.token(user);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        ctx.http
          .post('/api/v1/me/wallet/withdrawals')
          .set(bearer(token))
          .set('Idempotency-Key', randomUUID())
          .send({
            amount: '20000',
            currency: 'XAF',
            method: 'MOBILE_MONEY',
            phone: '+237677001122',
          }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect((await ctx.balance(user.id)).blocked).toBe(40_000n);
  });
});

describe('US-7.5 — remboursement', () => {
  async function completedDeposit(user: TestUser) {
    const { token, payment } = await processingDeposit(user);
    await confirmUssd(token, payment.providerReference);
    await ctx.drain();
    await ctx.drain();
    return payment;
  }

  it('API refund PSP + reversement interne, dépôt REFUNDED, événement payment.refunded', async () => {
    const user = await ctx.createUser();
    const payment = await completedDeposit(user);
    const admin = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post(`/api/v1/admin/payments/${payment.id}/refund`)
      .set(bearer(await ctx.token(admin)))
      .send({ reason: 'Dépôt effectué par erreur' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'REFUND', status: 'COMPLETED', refundOfId: payment.id });
    expect(await ctx.balance(user.id)).toEqual({ balance: 0n, blocked: 0n });
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'REFUNDED',
    );
    expect(await ctx.prisma.outboxEvent.count({ where: { eventType: 'payment.refunded' } })).toBe(
      1,
    );
    const again = await ctx.http
      .post(`/api/v1/admin/payments/${payment.id}/refund`)
      .set(bearer(await ctx.token(admin)))
      .send({ reason: 'Dépôt effectué par erreur' });
    expect(again.status).toBe(422);
  });

  it('fonds déjà dépensés : remboursement refusé', async () => {
    const user = await ctx.createUser();
    const payment = await completedDeposit(user);
    const other = await ctx.createUser();
    await ctx.http
      .post('/api/v1/me/wallet/transfers')
      .set(bearer(await ctx.token(user)))
      .set('Idempotency-Key', randomUUID())
      .send({ toMemberId: other.id, amount: '20000', currency: 'XAF' });
    const admin = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post(`/api/v1/admin/payments/${payment.id}/refund`)
      .set(bearer(await ctx.token(admin)))
      .send({ reason: 'Dépôt effectué par erreur' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('membre : remboursement interdit', async () => {
    const user = await ctx.createUser();
    const res = await ctx.http
      .post(`/api/v1/admin/payments/${randomUUID()}/refund`)
      .set(bearer(await ctx.token(user)))
      .send({ reason: 'Je veux mon argent' });
    expect(res.status).toBe(403);
  });
});

describe('prestataires réels (Flutterwave / Paystack) : squelettes désactivés', () => {
  it('aucune opération financière possible, webhook non configuré refusé', async () => {
    const fw = registry.get('flutterwave')!;
    expect(fw.enabled).toBe(false);
    await expect(
      fw.collectCard({
        merchantReference: randomUUID(),
        amountMinor: 1n,
        currency: 'XAF',
        customer: { id: 'x', email: null, name: 'x' },
      }),
    ).rejects.toBeInstanceOf(ProviderDisabledError);
    await expect(
      registry
        .get('paystack')!
        .payout({
          merchantReference: randomUUID(),
          amountMinor: 1n,
          currency: 'NGN',
          phone: '+2348000000000',
        }),
    ).rejects.toBeInstanceOf(ProviderDisabledError);
    const res = await ctx.http
      .post('/api/v1/payments/webhooks/paystack')
      .set('content-type', 'application/json')
      .set('x-paystack-signature', 'abc')
      .send('{"event":"charge.success"}');
    expect(res.status).toBe(401);
    expect((await ctx.http.post('/api/v1/payments/webhooks/inconnu').send('{}')).status).toBe(404);
  });
});
