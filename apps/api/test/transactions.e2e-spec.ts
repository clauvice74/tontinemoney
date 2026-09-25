import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ComplianceService } from '@tontine/compliance';
import { TransactionsService } from '@tontine/transactions';
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

async function seedRule(
  code: string,
  ruleType: string,
  operationTypes: string[],
  params: Record<string, unknown>,
  country = 'CM',
) {
  await ctx.prisma.complianceRule.create({
    data: {
      code,
      countryCode: country,
      ruleType: ruleType as never,
      operationTypes: operationTypes as never,
      params: params as object,
      active: true,
    },
  });
  await ctx.app.get(ComplianceService).invalidate(country);
}

async function transfer(token: string, body: Record<string, unknown>, key: string = randomUUID()) {
  return ctx.http
    .post('/api/v1/me/wallet/transfers')
    .set(bearer(token))
    .set('Idempotency-Key', key)
    .send(body);
}

describe('US-5.6 — transfert entre membres', () => {
  let a: TestUser;
  let b: TestUser;
  let tokenA: string;

  beforeEach(async () => {
    a = await ctx.createUser({ firstName: 'Awa' });
    b = await ctx.createUser({ firstName: 'Bello' });
    await ctx.fund(a.id, 100_000n);
    tokenA = await ctx.token(a);
  });

  it('nominal : débit A et crédit B atomiques, transaction COMPLETED, partie double', async () => {
    const res = await transfer(tokenA, {
      toMemberId: b.id,
      amount: '25000',
      currency: 'XAF',
      note: 'Remboursement',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('COMPLETED');
    expect((await ctx.balance(a.id)).balance).toBe(75_000n);
    expect((await ctx.balance(b.id)).balance).toBe(25_000n);
    const movements = await ctx.prisma.walletMovement.findMany({
      where: { transactionId: res.body.id },
    });
    const debit = movements
      .filter((m) => m.type === 'DEBIT')
      .reduce((s, m) => s + m.amountMinor, 0n);
    const credit = movements
      .filter((m) => m.type === 'CREDIT')
      .reduce((s, m) => s + m.amountMinor, 0n);
    expect(debit).toBe(credit);
  });

  it('destinataire par identifiant (téléphone)', async () => {
    const res = await transfer(tokenA, { toIdentifier: b.phone, amount: '1000', currency: 'XAF' });
    expect(res.status).toBe(201);
    expect((await ctx.balance(b.id)).balance).toBe(1_000n);
  });

  it('Idempotency-Key obligatoire', async () => {
    const res = await ctx.http
      .post('/api/v1/me/wallet/transfers')
      .set(bearer(tokenA))
      .send({ toMemberId: b.id, amount: '10', currency: 'XAF' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('double soumission (même clé) : un seul débit, même réponse', async () => {
    const key = randomUUID();
    const r1 = await transfer(tokenA, { toMemberId: b.id, amount: '10000', currency: 'XAF' }, key);
    const r2 = await transfer(tokenA, { toMemberId: b.id, amount: '10000', currency: 'XAF' }, key);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);
    expect((await ctx.balance(a.id)).balance).toBe(90_000n);
    expect(await ctx.prisma.transaction.count({ where: { type: 'TRANSFER' } })).toBe(1);
  });

  it('même clé avec un corps différent : refusé', async () => {
    const key = randomUUID();
    await transfer(tokenA, { toMemberId: b.id, amount: '10000', currency: 'XAF' }, key);
    const r2 = await transfer(tokenA, { toMemberId: b.id, amount: '20000', currency: 'XAF' }, key);
    expect(r2.status).toBe(422);
    expect(r2.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await ctx.balance(a.id)).balance).toBe(90_000n);
  });

  it('solde insuffisant : refus, transaction REJECTED, aucun mouvement', async () => {
    const res = await transfer(tokenA, { toMemberId: b.id, amount: '150000', currency: 'XAF' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect((await ctx.balance(a.id)).balance).toBe(100_000n);
    const t = await ctx.prisma.transaction.findFirstOrThrow({ where: { type: 'TRANSFER' } });
    expect(t.status).toBe('REJECTED');
    expect(await ctx.prisma.walletMovement.count({ where: { transactionId: t.id } })).toBe(0);
  });

  it('transactions concurrentes : jamais de solde négatif (double débit impossible)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        transfer(tokenA, { toMemberId: b.id, amount: '30000', currency: 'XAF' }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(3);
    expect(
      results.filter((r) => r.status !== 201).every((r) => r.body.code === 'INSUFFICIENT_FUNDS'),
    ).toBe(true);
    expect((await ctx.balance(a.id)).balance).toBe(10_000n);
    expect((await ctx.balance(b.id)).balance).toBe(90_000n);
  });

  it('devise différente : CURRENCY_MISMATCH', async () => {
    const felix = await ctx.createUser({ country: 'CI' });
    const res = await transfer(tokenA, { toMemberId: felix.id, amount: '1000', currency: 'XAF' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CURRENCY_MISMATCH');
  });

  it('vers soi-même : refusé', async () => {
    const res = await transfer(tokenA, { toMemberId: a.id, amount: '1000', currency: 'XAF' });
    expect(res.status).toBe(422);
  });

  it('KYC insuffisant (TIER_1) : refusé', async () => {
    const low = await ctx.createUser({ kycLevel: 'TIER_1' });
    await ctx.fund(low.id, 10_000n);
    const res = await transfer(await ctx.token(low), {
      toMemberId: b.id,
      amount: '1000',
      currency: 'XAF',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('KYC_LEVEL_INSUFFICIENT');
  });

  it('isolation : un membre ne voit que ses transactions', async () => {
    const res = await transfer(tokenA, { toMemberId: b.id, amount: '1000', currency: 'XAF' });
    const c = await ctx.createUser();
    const tokenC = await ctx.token(c);
    const other = await ctx.http.get(`/api/v1/me/transactions/${res.body.id}`).set(bearer(tokenC));
    expect(other.status).toBe(404);
    const mineB = await ctx.http.get('/api/v1/me/transactions').set(bearer(await ctx.token(b)));
    expect(mineB.body.data.some((t: { id: string }) => t.id === res.body.id)).toBe(true);
    const mineC = await ctx.http.get('/api/v1/me/transactions').set(bearer(tokenC));
    expect(mineC.body.data).toHaveLength(0);
  });
});

describe('US-6.1 / US-6.5 — pipeline et journal d’audit immuable', () => {
  it('étapes INITIATED → VALIDATION → EXECUTION journalisées, journal non modifiable', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 50_000n);
    const res = await transfer(await ctx.token(a), {
      toMemberId: b.id,
      amount: '5000',
      currency: 'XAF',
    });
    const admin = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const trail = await ctx.http
      .get(`/api/v1/admin/transactions/${res.body.id}/audit`)
      .set(bearer(await ctx.token(admin)));
    expect(trail.status).toBe(200);
    const steps = trail.body.data.map((r: { action: string }) => r.action);
    expect(steps[0]).toBe('INITIATED');
    expect(steps).toContain('VALIDATION');
    expect(steps).toContain('EXECUTED');
    // R-TRX-07 : rétention ≥ 7 ans
    const retain =
      new Date(trail.body.data[0].retainUntil).getTime() -
      new Date(trail.body.data[0].createdAt).getTime();
    expect(retain).toBeGreaterThanOrEqual(7 * 365 * 86_400_000);
    // append-only : UPDATE / DELETE refusés par la base
    await expect(
      ctx.prisma.$executeRawUnsafe(`UPDATE "trx_audit_logs" SET "action" = 'X'`),
    ).rejects.toThrow();
    await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "wal_movements"`)).rejects.toThrow();
  });

  it('un membre n’accède pas au journal d’audit admin', async () => {
    const a = await ctx.createUser();
    const res = await ctx.http
      .get(`/api/v1/admin/transactions/${randomUUID()}/audit`)
      .set(bearer(await ctx.token(a)));
    expect(res.status).toBe(403);
  });

  it('montant ≥ seuil de fraude simulé : transaction rejetée', async () => {
    const a = await ctx.createUser({ kycLevel: 'TIER_3' });
    const b = await ctx.createUser();
    await ctx.fund(a.id, 60_000_000n);
    const res = await transfer(await ctx.token(a), {
      toMemberId: b.id,
      amount: '50000000',
      currency: 'XAF',
    });
    expect(res.status).toBe(422);
    expect((await ctx.balance(a.id)).balance).toBe(60_000_000n);
  });
});

describe('US-6.4 — contre-passation', () => {
  it('annule un transfert par écriture inverse, idempotent, statut REVERSED', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 20_000n);
    const t = await transfer(await ctx.token(a), {
      toMemberId: b.id,
      amount: '8000',
      currency: 'XAF',
    });
    const admin = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(admin);
    const r1 = await ctx.http
      .post(`/api/v1/admin/transactions/${t.body.id}/reverse`)
      .set(bearer(token))
      .send({ reason: 'Erreur de destinataire' });
    expect(r1.status).toBe(200);
    expect(r1.body.type).toBe('REVERSAL');
    const r2 = await ctx.http
      .post(`/api/v1/admin/transactions/${t.body.id}/reverse`)
      .set(bearer(token))
      .send({ reason: 'Erreur de destinataire' });
    expect(r2.body.id).toBe(r1.body.id);
    expect((await ctx.balance(a.id)).balance).toBe(20_000n);
    expect((await ctx.balance(b.id)).balance).toBe(0n);
    const original = await ctx.prisma.transaction.findUniqueOrThrow({ where: { id: t.body.id } });
    expect(original.status).toBe('REVERSED');
    // l'écriture d'origine est conservée (pas de suppression)
    expect(
      await ctx.prisma.walletMovement.count({ where: { transactionId: t.body.id } }),
    ).toBeGreaterThan(0);
  });

  it('transaction non complétée : transition invalide', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    const t = await transfer(await ctx.token(a), {
      toMemberId: b.id,
      amount: '8000',
      currency: 'XAF',
    });
    const rejected = await ctx.prisma.transaction.findFirstOrThrow({ where: { type: 'TRANSFER' } });
    expect(t.status).toBe(422);
    await expect(
      ctx.app.get(TransactionsService).reverse(rejected.id, 'test'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
});

describe('US-6.6 — réconciliation interne', () => {
  it('aucun écart sur un grand livre cohérent ; écart détecté si un solde est altéré', async () => {
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 20_000n);
    await transfer(await ctx.token(a), { toMemberId: b.id, amount: '5000', currency: 'XAF' });
    const clean = await ctx.jobs.run('transactions.reconcile', 'test');
    expect(clean.summary['discrepancies']).toBe(0);
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE "wal_wallets" SET "balanceMinor" = "balanceMinor" + 1 WHERE "memberId" = '${b.id}'`,
    );
    const dirty = await ctx.jobs.run('transactions.reconcile', 'test');
    expect(dirty.summary['discrepancies']).toBe(1);
    const report = await ctx.prisma.reconciliationReport.findFirstOrThrow({
      where: { status: 'DISCREPANCIES' },
    });
    expect(report.alert).toBe(true);
  });
});

describe('US-9.2 / US-9.3 / US-9.4 — conformité', () => {
  let admin: TestUser;
  let adminToken: string;

  beforeEach(async () => {
    admin = await ctx.createUser({ role: 'SUPER_ADMIN' });
    adminToken = await ctx.token(admin);
  });

  it('API de validation : conforme puis limite journalière dépassée', async () => {
    await seedRule('CM-DAILY-TRANSFER', 'DAILY_LIMIT', ['TRANSFER'], { limitMinor: '30000' });
    const m = await ctx.createUser();
    const ok = await ctx.http
      .post('/api/v1/compliance/validate')
      .set(bearer(adminToken))
      .send({ operationType: 'TRANSFER', memberId: m.id, amountMinor: '20000', currency: 'XAF' });
    expect(ok.status).toBe(200);
    expect(ok.body.compliant).toBe(true);
    expect(ok.body.appliedRules).toContain('CM-DAILY-TRANSFER');
    const ko = await ctx.http
      .post('/api/v1/compliance/validate')
      .set(bearer(adminToken))
      .send({ operationType: 'TRANSFER', memberId: m.id, amountMinor: '40000', currency: 'XAF' });
    expect(ko.body.compliant).toBe(false);
    expect(ko.body.violations[0].rule).toBe('CM-DAILY-TRANSFER');
  });

  it('membre : validation interdite (403)', async () => {
    const m = await ctx.createUser();
    const res = await ctx.http
      .post('/api/v1/compliance/validate')
      .set(bearer(await ctx.token(m)))
      .send({ operationType: 'TRANSFER', memberId: m.id, amountMinor: '1', currency: 'XAF' });
    expect(res.status).toBe(403);
  });

  it('cumul journalier appliqué au transfert réel + violation journalisée et événement publié', async () => {
    await seedRule('CM-DAILY-TRANSFER', 'DAILY_LIMIT', ['TRANSFER'], { limitMinor: '30000' });
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 100_000n);
    const token = await ctx.token(a);
    expect(
      (await transfer(token, { toMemberId: b.id, amount: '20000', currency: 'XAF' })).status,
    ).toBe(201);
    const ko = await transfer(token, { toMemberId: b.id, amount: '15000', currency: 'XAF' });
    expect(ko.status).toBe(422);
    expect(ko.body.code).toBe('COMPLIANCE_VIOLATION');
    const v = await ctx.prisma.complianceViolation.findFirstOrThrow({ where: { memberId: a.id } });
    expect(v.ruleCode).toBe('CM-DAILY-TRANSFER');
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'compliance.violation.detected' } }),
    ).toBe(1);
    // le lendemain, le cumul repart à zéro
    ctx.clock.advance(24 * 3600_000);
    expect(
      (await transfer(await ctx.token(a), { toMemberId: b.id, amount: '15000', currency: 'XAF' }))
        .status,
    ).toBe(201);
  });

  it('plafond de wallet du destinataire (WALLET_LIMIT)', async () => {
    await seedRule('CM-WALLET-CAP', 'WALLET_LIMIT', ['TRANSFER', 'DEPOSIT'], {
      limitMinor: '50000',
    });
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 100_000n);
    const res = await transfer(await ctx.token(a), {
      toMemberId: b.id,
      amount: '60000',
      currency: 'XAF',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COMPLIANCE_VIOLATION');
  });

  it('5 violations en 24 h : suspension automatique du membre', async () => {
    await seedRule('CM-DAILY-TRANSFER', 'DAILY_LIMIT', ['TRANSFER'], { limitMinor: '1000' });
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 100_000n);
    const token = await ctx.token(a);
    for (let i = 0; i < 5; i++)
      await transfer(token, { toMemberId: b.id, amount: '5000', currency: 'XAF' });
    await ctx.drain();
    const member = await ctx.prisma.member.findUniqueOrThrow({ where: { id: a.id } });
    expect(member.status).toBe('SUSPENDED');
  });

  it('règle avec onViolation=SUSPEND : suspension immédiate', async () => {
    await seedRule('CM-FORBID-TRANSFER', 'OPERATION_FORBIDDEN', ['TRANSFER'], {
      onViolation: 'SUSPEND',
    });
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 10_000n);
    await transfer(await ctx.token(a), { toMemberId: b.id, amount: '100', currency: 'XAF' });
    await ctx.drain();
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'SUSPENDED',
    );
  });

  it('US-9.3 : création, modification sans redéploiement (effet immédiat), historique versionné', async () => {
    const create = await ctx.http
      .post('/api/v1/admin/compliance/rules')
      .set(bearer(adminToken))
      .send({
        code: 'CM-DAILY-TRANSFER',
        countryCode: 'CM',
        ruleType: 'DAILY_LIMIT',
        operationTypes: ['TRANSFER'],
        params: { limitMinor: '5000' },
      });
    expect(create.status).toBe(201);
    const a = await ctx.createUser();
    const b = await ctx.createUser();
    await ctx.fund(a.id, 100_000n);
    const token = await ctx.token(a);
    expect(
      (await transfer(token, { toMemberId: b.id, amount: '8000', currency: 'XAF' })).status,
    ).toBe(422);
    const upd = await ctx.http
      .patch('/api/v1/admin/compliance/rules/CM-DAILY-TRANSFER')
      .set(bearer(adminToken))
      .send({ params: { limitMinor: '10000' }, changeReason: 'Relèvement du plafond BEAC' });
    expect(upd.status).toBe(200);
    expect(upd.body.version).toBe(2);
    expect(
      (await transfer(token, { toMemberId: b.id, amount: '8000', currency: 'XAF' })).status,
    ).toBe(201);
    const hist = await ctx.http
      .get('/api/v1/admin/compliance/rules/CM-DAILY-TRANSFER/history')
      .set(bearer(adminToken));
    expect(hist.body.data.map((h: { version: number }) => h.version)).toEqual([2, 1]);
  });

  it('US-9.3 : paramètres invalides et code dupliqué refusés', async () => {
    const bad = await ctx.http
      .post('/api/v1/admin/compliance/rules')
      .set(bearer(adminToken))
      .send({
        code: 'CM-BAD-RULE',
        countryCode: 'CM',
        ruleType: 'DAILY_LIMIT',
        operationTypes: ['TRANSFER'],
        params: { limitMinor: 12.5 },
      });
    expect(bad.status).toBe(400);
    const body = {
      code: 'CM-KYC-MIN',
      countryCode: 'CM',
      ruleType: 'KYC_MIN_LEVEL',
      operationTypes: ['TRANSFER'],
      params: { minLevel: 'TIER_2' },
    };
    expect(
      (await ctx.http.post('/api/v1/admin/compliance/rules').set(bearer(adminToken)).send(body))
        .status,
    ).toBe(201);
    expect(
      (await ctx.http.post('/api/v1/admin/compliance/rules').set(bearer(adminToken)).send(body))
        .status,
    ).toBe(409);
  });
});
