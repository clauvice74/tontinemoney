import { randomUUID } from 'node:crypto';
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

async function walletOf(user: TestUser) {
  return ctx.prisma.wallet.findUniqueOrThrow({ where: { memberId: user.id } });
}

/** Dépôt Mobile Money mené jusqu'au crédit du wallet, via la route alias. */
async function completedDeposit(user: TestUser, amount = '25000') {
  const token = await ctx.token(user);
  const res = await ctx.http
    .post('/api/v1/payments/mobile-money')
    .set(bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({ amount, currency: 'XAF', phone: '+237677001122' });
  expect(res.status).toBe(201);
  await ctx.http
    .post(`/api/v1/psp-sim/mobile-money/${res.body.providerReference}/confirm`)
    .set(bearer(token))
    .send({ outcome: 'SUCCESS', deliverWebhook: true })
    .expect(200);
  await ctx.drain();
  await ctx.drain();
  return res.body as { id: string };
}

describe('Portefeuille par identifiant — /wallets/:id', () => {
  it('le titulaire lit son portefeuille, son solde et ses mouvements', async () => {
    const m = await ctx.createUser();
    await ctx.fund(m.id, 40_000n);
    const w = await walletOf(m);
    const token = await ctx.token(m);
    const one = await ctx.http.get(`/api/v1/wallets/${w.id}`).set(bearer(token));
    expect(one.status).toBe(200);
    expect(one.body).toEqual((await ctx.http.get('/api/v1/me/wallet').set(bearer(token))).body);
    const bal = await ctx.http.get(`/api/v1/wallets/${w.id}/balance`).set(bearer(token));
    expect(bal.body).toMatchObject({ id: w.id, currency: 'XAF', balance: { amount: '40000' } });
    expect(bal.body.status).toBeUndefined();
    const hist = await ctx.http.get(`/api/v1/wallets/${w.id}/history`).set(bearer(token));
    expect(hist.body.data).toHaveLength(1);
    expect(hist.body.data[0]).toMatchObject({ type: 'CREDIT', context: 'DEPOSIT' });
  });

  it('autre membre → 404 (existence non révélée) + refus journalisé ; super-admin → lecture journalisée', async () => {
    const owner = await ctx.createUser();
    const w = await walletOf(owner);
    const other = await ctx.createUser();
    for (const path of ['', '/balance', '/history']) {
      const res = await ctx.http
        .get(`/api/v1/wallets/${w.id}${path}`)
        .set(bearer(await ctx.token(other)));
      expect(res.status).toBe(404);
    }
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'access.denied', resourceId: w.id } }),
    ).toBe(3);
    const unknown = await ctx.http
      .get(`/api/v1/wallets/${randomUUID()}`)
      .set(bearer(await ctx.token(other)));
    expect(unknown.status).toBe(404);

    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http.get(`/api/v1/wallets/${w.id}`).set(bearer(await ctx.token(sa)));
    expect(res.status).toBe(200);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'wallet.read_by_staff', resourceId: w.id },
      }),
    ).toBe(1);
  });

  it('curseur malformé ignoré (pas d’erreur 500)', async () => {
    const m = await ctx.createUser();
    const w = await walletOf(m);
    const bad = Buffer.from(JSON.stringify({ k: 'abc', id: 'x' })).toString('base64url');
    const res = await ctx.http
      .get(`/api/v1/wallets/${w.id}/history?cursor=${bad}`)
      .set(bearer(await ctx.token(m)));
    expect(res.status).toBe(200);
  });
});

describe('Paiements — alias', () => {
  it('/payments/mobile-money crédite le wallet ; /payments et /payments/:id = /me/payments', async () => {
    const m = await ctx.createUser();
    const p = await completedDeposit(m);
    expect(await ctx.balance(m.id)).toEqual({ balance: 25_000n, blocked: 0n });
    const token = await ctx.token(m);
    const list = await ctx.http.get('/api/v1/payments').set(bearer(token));
    expect(list.body).toEqual((await ctx.http.get('/api/v1/me/payments').set(bearer(token))).body);
    const one = await ctx.http.get(`/api/v1/payments/${p.id}`).set(bearer(token));
    expect(one.body).toMatchObject({ id: p.id, status: 'COMPLETED', method: 'MOBILE_MONEY' });
    const other = await ctx.createUser();
    expect(
      (await ctx.http.get(`/api/v1/payments/${p.id}`).set(bearer(await ctx.token(other)))).status,
    ).toBe(404);
  });

  it('/payments/card force la méthode carte ; champ « method » refusé ; Idempotency-Key obligatoire', async () => {
    const m = await ctx.createUser();
    const token = await ctx.token(m);
    const card = await ctx.http
      .post('/api/v1/payments/card')
      .set(bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '15000', currency: 'XAF' });
    expect(card.status).toBe(201);
    expect(card.body.method).toBe('CARD');
    const extra = await ctx.http
      .post('/api/v1/payments/card')
      .set(bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '15000', currency: 'XAF', method: 'MOBILE_MONEY' });
    expect(extra.status).toBe(400);
    const noKey = await ctx.http
      .post('/api/v1/payments/deposit')
      .set(bearer(token))
      .send({ amount: '1000', currency: 'XAF', method: 'CARD' });
    expect(noKey.status).toBe(400);
  });

  it('même Idempotency-Key sur /payments/deposit et /me/wallet/deposits → rejoué, un seul paiement', async () => {
    const m = await ctx.createUser();
    const token = await ctx.token(m);
    const key = randomUUID();
    const body = { amount: '5000', currency: 'XAF', method: 'CARD' };
    const a = await ctx.http
      .post('/api/v1/payments/deposit')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send(body);
    const b = await ctx.http
      .post('/api/v1/me/wallet/deposits')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send(body);
    expect(b.body.id).toBe(a.body.id);
    expect(await ctx.prisma.payment.count({ where: { memberId: m.id } })).toBe(1);
  });

  it('/payments/refund (super-admin) rembourse ; refusé au membre', async () => {
    const m = await ctx.createUser();
    const p = await completedDeposit(m);
    const denied = await ctx.http
      .post('/api/v1/payments/refund')
      .set(bearer(await ctx.token(m)))
      .send({ paymentId: p.id, reason: 'Erreur' });
    expect(denied.status).toBe(403);
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post('/api/v1/payments/refund')
      .set(bearer(await ctx.token(sa)))
      .send({ paymentId: p.id, reason: 'Dépôt effectué par erreur' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'REFUND', refundOfId: p.id });
    expect(await ctx.balance(m.id)).toEqual({ balance: 0n, blocked: 0n });
  });

  it('/payments/reconcile (super-admin) produit un rapport PSP ; refusé au membre', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const res = await ctx.http
      .post('/api/v1/payments/reconcile')
      .set(bearer(await ctx.token(sa)))
      .send({ date: '2026-09-23' });
    expect(res.status).toBe(200);
    expect(
      await ctx.prisma.reconciliationReport.count({ where: { kind: 'PSP' } }),
    ).toBeGreaterThanOrEqual(1);
    const m = await ctx.createUser();
    await ctx.http
      .post('/api/v1/payments/reconcile')
      .set(bearer(await ctx.token(m)))
      .send({})
      .expect(403);
  });
});

describe('Transactions — alias', () => {
  it('/transactions et /transactions/:id = /me/transactions ; reverse réservé au super-admin', async () => {
    const m = await ctx.createUser();
    await ctx.fund(m.id, 10_000n);
    const token = await ctx.token(m);
    const list = await ctx.http.get('/api/v1/transactions').set(bearer(token));
    expect(list.body).toEqual(
      (await ctx.http.get('/api/v1/me/transactions').set(bearer(token))).body,
    );
    const id = list.body.data[0].id as string;
    const one = await ctx.http.get(`/api/v1/transactions/${id}`).set(bearer(token));
    expect(one.body.id).toBe(id);
    await ctx.http
      .post(`/api/v1/transactions/${id}/reverse`)
      .set(bearer(token))
      .send({ reason: 'x' })
      .expect(403);
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const rev = await ctx.http
      .post(`/api/v1/transactions/${id}/reverse`)
      .set(bearer(await ctx.token(sa)))
      .send({ reason: 'Erreur de saisie' });
    expect(rev.status).toBe(200);
    expect(await ctx.balance(m.id)).toEqual({ balance: 0n, blocked: 0n });
  });
});

describe('Notifications — /notifications et /notifications/:id', () => {
  it('liste identique à /me/notifications ; lecture unitaire limitée au destinataire', async () => {
    const m = await ctx.createUser();
    await completedDeposit(m);
    const token = await ctx.token(m);
    const list = await ctx.http.get('/api/v1/notifications').set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body).toEqual(
      (await ctx.http.get('/api/v1/me/notifications').set(bearer(token))).body,
    );
    expect(list.body.data.length).toBeGreaterThan(0);
    const id = list.body.data[0].id as string;
    const one = await ctx.http.get(`/api/v1/notifications/${id}`).set(bearer(token));
    expect(one.body).toEqual(list.body.data[0]);
    const other = await ctx.createUser();
    expect(
      (await ctx.http.get(`/api/v1/notifications/${id}`).set(bearer(await ctx.token(other))))
        .status,
    ).toBe(404);
  });
});
