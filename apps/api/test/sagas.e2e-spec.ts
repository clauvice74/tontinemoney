import { randomUUID } from 'node:crypto';
import { ComplianceService } from '@tontine/compliance';
import { buildEnvelope } from '@tontine/events';
import { EventDispatcher } from '@tontine/platform';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, type TestUser, bearer, createTestContext } from './support/test-app';
import { type StartedTontine, payCurrent, settle, startTontine } from './support/tontine';

/** Étape 5 (A-53) : sagas orchestrées par Transaction Service. */
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

/** Dépôt Mobile Money confirmé par le PSP simulé (webhook signé livré, événements non relayés). */
async function confirmedDeposit(user: TestUser, amount = '25000') {
  const token = await ctx.token(user);
  const res = await ctx.http
    .post('/api/v1/me/wallet/deposits')
    .set(bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({ amount, currency: 'XAF', method: 'MOBILE_MONEY', phone: '+237677001122' });
  expect(res.status).toBe(201);
  await ctx.http
    .post(`/api/v1/psp-sim/mobile-money/${res.body.providerReference}/confirm`)
    .set(bearer(token))
    .send({ outcome: 'SUCCESS', deliverWebhook: true })
    .expect(200);
  return { token, paymentId: res.body.id as string };
}

async function steps(sagaId: string) {
  const rows = await ctx.prisma.transactionSagaStep.findMany({
    where: { sagaId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((s) => s.toStep);
}

describe('Saga PAYMENT_SETTLEMENT (dépôt)', () => {
  it('payment.completed → écritures → transaction.saga.completed → transaction rattachée au paiement', async () => {
    const user = await ctx.createUser();
    const { paymentId } = await confirmedDeposit(user);
    await ctx.drain();
    const saga = await ctx.prisma.transactionSaga.findUniqueOrThrow({
      where: { sagaKey: `payment-settlement:${paymentId}` },
    });
    expect(saga).toMatchObject({
      type: 'PAYMENT_SETTLEMENT',
      status: 'COMPLETED',
      reference: paymentId,
      attempts: 1,
    });
    expect(await steps(saga.id)).toEqual(['STARTED', 'LEDGER_POSTING', 'COMPLETED']);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.transactionId).toBe(saga.transactionId);
    expect((await ctx.balance(user.id)).balance).toBe(25_000n);
    const reply = await ctx.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'transaction.saga.completed', aggregateId: saga.id },
    });
    // Causalité : la réponse de la saga est causée par l'événement de paiement
    const trigger = await ctx.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'payment.completed', aggregateId: paymentId },
    });
    expect(reply.causationId).toBe(trigger.id);
  });

  it('redélivrance de payment.completed (autre eventId) : aucune double écriture', async () => {
    const user = await ctx.createUser();
    const { paymentId } = await confirmedDeposit(user);
    await ctx.drain();
    const original = await ctx.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'payment.completed', aggregateId: paymentId },
    });
    const again = buildEnvelope(
      {
        type: 'payment.completed',
        aggregateType: 'payment',
        aggregateId: paymentId,
        payload: original.payload as never,
      },
      { correlationId: 'corr-redelivery' },
    );
    await ctx.app.get(EventDispatcher).dispatch(again);
    await ctx.drain();
    expect((await ctx.balance(user.id)).balance).toBe(25_000n);
    expect(
      await ctx.prisma.transaction.count({
        where: { contextType: 'PAYMENT', contextId: paymentId },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.transactionSaga.count({
        where: { sagaKey: `payment-settlement:${paymentId}` },
      }),
    ).toBe(1);
  });

  it('échec métier (wallet fermé) : saga FAILED, alerte de réconciliation, paiement marqué', async () => {
    const user = await ctx.createUser();
    const { paymentId } = await confirmedDeposit(user);
    await ctx.prisma.wallet.update({ where: { memberId: user.id }, data: { status: 'CLOSED' } });
    await ctx.drain();
    const saga = await ctx.prisma.transactionSaga.findUniqueOrThrow({
      where: { sagaKey: `payment-settlement:${paymentId}` },
    });
    expect(saga).toMatchObject({ status: 'FAILED', failureCode: 'WALLET_NOT_OPERATIONAL' });
    expect(await steps(saga.id)).toEqual(['STARTED', 'LEDGER_POSTING', 'FAILED']);
    const failed = await ctx.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'transaction.saga.failed', aggregateId: saga.id },
    });
    expect(failed.payload).toMatchObject({
      sagaType: 'PAYMENT_SETTLEMENT',
      reference: paymentId,
      compensated: false,
      requiresReconciliation: true,
    });
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment).toMatchObject({
      status: 'COMPLETED',
      transactionId: null,
      errorCode: 'SETTLEMENT_FAILED',
    });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'transaction.saga.reconciliation_required', resourceId: saga.id },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'payment.settlement.failed', resourceId: paymentId },
      }),
    ).toBe(1);
  });
});

describe('Consultation des sagas (super-admin)', () => {
  it('liste filtrée, détail avec journal des transitions ; interdit aux membres', async () => {
    const user = await ctx.createUser();
    const { paymentId } = await confirmedDeposit(user);
    await ctx.drain();
    const admin = await ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
    const list = await ctx.http
      .get(`/api/v1/admin/sagas?type=PAYMENT_SETTLEMENT&reference=${paymentId}`)
      .set(bearer(admin))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ status: 'COMPLETED', reference: paymentId });
    const one = await ctx.http
      .get(`/api/v1/admin/sagas/${list.body.data[0].id}`)
      .set(bearer(admin))
      .expect(200);
    expect(one.body.steps.map((s: { to: string }) => s.to)).toEqual([
      'STARTED',
      'LEDGER_POSTING',
      'COMPLETED',
    ]);
    await ctx.http
      .get('/api/v1/admin/sagas')
      .set(bearer(await ctx.token(user)))
      .expect(403);
  });
});

describe('Saga TONTINE_PAYOUT (paiement du bénéficiaire)', () => {
  async function lastPayment(s: StartedTontine) {
    const cycle = await ctx.prisma.tontineCycle.findFirstOrThrow({
      where: { tontineId: s.tontineId, number: 1 },
    });
    return cycle;
  }

  it('collecte complète → demande → saga COMPLETED → cycle clos, cycle suivant ouvert', async () => {
    const s = await startTontine(ctx);
    for (const u of s.users) expect((await payCurrent(ctx, s, u)).status).toBe(202);
    await settle(ctx);
    const cycle = await lastPayment(s);
    expect(cycle).toMatchObject({ status: 'COMPLETED', payoutMinor: 29_000n });
    const saga = await ctx.prisma.transactionSaga.findFirstOrThrow({
      where: { type: 'TONTINE_PAYOUT', reference: cycle.id },
    });
    expect(saga).toMatchObject({ status: 'COMPLETED', transactionId: cycle.payoutTxId });
    expect(await steps(saga.id)).toEqual(['STARTED', 'COMPLIANCE_AND_LEDGER', 'COMPLETED']);
    expect(await ctx.prisma.tontineCycle.count({ where: { tontineId: s.tontineId } })).toBe(2);
  });

  it('échec (wallet du bénéficiaire fermé) : aucune écriture, cycle PAYOUT_PENDING, relance possible', async () => {
    const s = await startTontine(ctx);
    const cycle = await lastPayment(s);
    const pool = await ctx.prisma.tontine.findUniqueOrThrow({ where: { id: s.tontineId } });
    // Le bénéficiaire paie d'abord ; son wallet est fermé avant la dernière contribution
    const ordered = [
      ...s.users.filter((u) => u.id === cycle.beneficiaryId),
      ...s.users.filter((u) => u.id !== cycle.beneficiaryId),
    ];
    for (const u of ordered.slice(0, -1)) expect((await payCurrent(ctx, s, u)).status).toBe(202);
    await settle(ctx);
    await ctx.prisma.wallet.update({
      where: { memberId: cycle.beneficiaryId! },
      data: { status: 'CLOSED' },
    });
    expect((await payCurrent(ctx, s, ordered.at(-1)!)).status).toBe(202);
    await settle(ctx);
    const blocked = await ctx.prisma.tontineCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(blocked).toMatchObject({ status: 'PAYOUT_PENDING', payoutMinor: null });
    const failed = await ctx.prisma.transactionSaga.findFirstOrThrow({
      where: { type: 'TONTINE_PAYOUT', reference: cycle.id },
    });
    expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'WALLET_NOT_OPERATIONAL' });
    expect(
      (await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: pool.poolWalletId! } }))
        .balanceMinor,
    ).toBe(30_000n);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'tontine.payout.blocked', resourceId: s.tontineId },
      }),
    ).toBe(1);

    // Correction puis relance explicite par l'admin : nouvelle saga, paiement effectué
    await ctx.prisma.wallet.update({
      where: { memberId: cycle.beneficiaryId! },
      data: { status: 'ACTIVE' },
    });
    await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/cycles/${cycle.id}/force-payout`)
      .set(bearer(await ctx.token(s.admin)))
      .send({ reason: 'Portefeuille réactivé' })
      .expect(202);
    await settle(ctx);
    expect(
      (await ctx.prisma.tontineCycle.findUniqueOrThrow({ where: { id: cycle.id } })).status,
    ).toBe('COMPLETED');
    expect(
      await ctx.prisma.transactionSaga.count({
        where: { type: 'TONTINE_PAYOUT', reference: cycle.id },
      }),
    ).toBe(2);
    expect(
      (await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: pool.poolWalletId! } }))
        .balanceMinor,
    ).toBe(0n);
  });
});

describe('Saga CONTRIBUTION (hold → conformité + capture)', () => {
  async function firstContribution(s: StartedTontine, user: TestUser) {
    return ctx.prisma.contribution.findFirstOrThrow({
      where: { tontineId: s.tontineId, memberId: user.id },
    });
  }

  it('nominal : 202 PROCESSING, puis HOLD → capture → PAID ; journal des transitions', async () => {
    const s = await startTontine(ctx);
    const bella = s.users[1]!;
    const res = await payCurrent(ctx, s, bella);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'PENDING', paymentStatus: 'PROCESSING' });
    const c = await firstContribution(s, bella);
    expect(c.paymentRequestId).not.toBeNull();
    await ctx.drain();
    const saga = await ctx.prisma.transactionSaga.findUniqueOrThrow({
      where: { sagaKey: `contribution:${c.paymentRequestId}` },
    });
    expect(saga).toMatchObject({ type: 'CONTRIBUTION', status: 'COMPLETED' });
    expect(await steps(saga.id)).toEqual([
      'STARTED',
      'HOLD',
      'COMPLIANCE_AND_CAPTURE',
      'COMPLETED',
    ]);
    expect(await firstContribution(s, bella)).toMatchObject({
      status: 'PAID',
      paymentRequestId: null,
      transactionId: saga.transactionId,
    });
    expect(await ctx.balance(bella.id)).toEqual({ balance: 90_000n, blocked: 0n });
  });

  it('compensation : refus de conformité après blocage → hold libéré, saga COMPENSATED, échéance due', async () => {
    const s = await startTontine(ctx);
    const bella = s.users[1]!;
    await ctx.prisma.complianceRule.create({
      data: {
        code: 'CM-CONTRIB-FORBIDDEN',
        countryCode: 'CM',
        ruleType: 'OPERATION_FORBIDDEN' as never,
        operationTypes: ['TONTINE_CONTRIBUTION'] as never,
        params: {},
        active: true,
      },
    });
    await ctx.app.get(ComplianceService).invalidate('CM');
    expect((await payCurrent(ctx, s, bella)).status).toBe(202);
    const requested = await firstContribution(s, bella);
    await ctx.drain();
    const saga = await ctx.prisma.transactionSaga.findUniqueOrThrow({
      where: { sagaKey: `contribution:${requested.paymentRequestId}` },
    });
    expect(saga).toMatchObject({ status: 'COMPENSATED', failureCode: 'COMPLIANCE_VIOLATION' });
    expect(await steps(saga.id)).toEqual([
      'STARTED',
      'HOLD',
      'COMPLIANCE_AND_CAPTURE',
      'COMPENSATED',
    ]);
    const hold = await ctx.prisma.walletHold.findUniqueOrThrow({
      where: { idempotencyKey: `contribution-hold:${requested.paymentRequestId}` },
    });
    expect(hold.status).toBe('RELEASED');
    expect(await ctx.balance(bella.id)).toEqual({ balance: 100_000n, blocked: 0n });
    const after = await firstContribution(s, bella);
    expect(after).toMatchObject({ status: 'PENDING', paymentRequestId: null });
    expect(after.paymentError).toBeTruthy();
    const view = await ctx.http
      .get(`/api/v1/contributions/${after.id}`)
      .set(bearer(await ctx.token(bella)));
    expect(view.body).toMatchObject({ paymentStatus: null, paymentError: after.paymentError });
    // nouvelle tentative possible (nouvelle demande, nouvelle saga)
    expect((await payCurrent(ctx, s, bella)).status).toBe(202);
    expect((await firstContribution(s, bella)).paymentRequestId).not.toBe(
      requested.paymentRequestId,
    );
  });

  it('échec au blocage (fonds dépensés entre la demande et la saga) : FAILED sans effet, wallet.debit.failed', async () => {
    const s = await startTontine(ctx);
    const bella = s.users[1]!;
    expect((await payCurrent(ctx, s, bella)).status).toBe(202);
    const requested = await firstContribution(s, bella);
    await ctx.prisma.wallet.update({
      where: { memberId: bella.id },
      data: { blockedMinor: 95_000n },
    });
    await ctx.drain();
    const saga = await ctx.prisma.transactionSaga.findUniqueOrThrow({
      where: { sagaKey: `contribution:${requested.paymentRequestId}` },
    });
    expect(saga).toMatchObject({ status: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS' });
    expect(await steps(saga.id)).toEqual(['STARTED', 'HOLD', 'FAILED']);
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'wallet.debit.failed' } }),
    ).toBe(1);
    expect((await firstContribution(s, bella)).paymentRequestId).toBeNull();
  });

  it('une échéance en cours de paiement n’est pas marquée en retard', async () => {
    const s = await startTontine(ctx);
    const bella = s.users[1]!;
    expect((await payCurrent(ctx, s, bella)).status).toBe(202);
    ctx.clock.set('2026-11-08T09:00:00.000Z');
    await ctx.jobs.run('tontines.late-detection', 'test');
    expect((await firstContribution(s, bella)).status).toBe('PENDING');
    await ctx.drain();
    expect((await firstContribution(s, bella)).status).toBe('PAID');
  });
});
