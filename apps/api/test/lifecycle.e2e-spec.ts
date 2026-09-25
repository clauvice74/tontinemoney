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

interface Started {
  admin: TestUser;
  users: TestUser[];
  tontineId: string;
}

/** Tontine de 3 membres démarrée le 2026-10-07 (contribution 10 000 XAF, collation 1 000). */
async function startedTontine(overrides: Record<string, unknown> = {}): Promise<Started> {
  const admin = await ctx.createUser({ kycLevel: 'TIER_3', firstName: 'Admin' });
  const adminToken = await ctx.token(admin);
  const res = await ctx.http
    .post('/api/v1/tontines')
    .set(bearer(adminToken))
    .send({
      name: `Tontine ${randomUUID().slice(0, 6)}`,
      contributionAmount: '10000',
      frequency: 'MONTHLY',
      frequencyDetail: { day: 'wednesday', weekOfMonth: 1 },
      maxMembers: 3,
      startDate: '2026-10-07',
      drawMode: 'RANDOM',
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 2, defaultAfterDays: 7 },
      collation: '1000',
      ...overrides,
    });
  expect(res.status).toBe(201);
  const tontineId = res.body.id as string;
  const link = await ctx.http
    .post(`/api/v1/tontines/${tontineId}/invitations`)
    .set(bearer(adminToken))
    .send({ channel: 'LINK' });
  const users = [admin];
  for (const name of ['Bella', 'Carl']) {
    const u = await ctx.createUser({ firstName: name });
    await ctx.http
      .post(`/api/v1/invitations/code/${link.body.code}/accept`)
      .set(bearer(await ctx.token(u)))
      .send()
      .expect(200);
    users.push(u);
  }
  await ctx.drain();
  ctx.clock.set('2026-10-07T08:00:00.000Z');
  await ctx.jobs.run('tontines.start', 'test');
  expect((await ctx.prisma.tontine.findUniqueOrThrow({ where: { id: tontineId } })).status).toBe(
    'ACTIVE',
  );
  for (const u of users) await ctx.fund(u.id, 100_000n);
  return { admin, users, tontineId };
}

async function payCurrent(s: Started, user: TestUser) {
  const t = await ctx.prisma.tontine.findUniqueOrThrow({ where: { id: s.tontineId } });
  const cycle = await ctx.prisma.tontineCycle.findUniqueOrThrow({
    where: { tontineId_number: { tontineId: s.tontineId, number: t.currentCycleNumber! } },
  });
  const c = await ctx.prisma.contribution.findFirstOrThrow({
    where: { cycleId: cycle.id, memberId: user.id },
  });
  return ctx.http
    .post(`/api/v1/tontines/${s.tontineId}/contributions/${c.id}/pay`)
    .set(bearer(await ctx.token(user)))
    .set('Idempotency-Key', randomUUID())
    .send();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await ctx.drain();
}

describe('US-4.7 / US-4.8 / US-4.9 — cycle de vie complet', () => {
  it('3 cycles : pot payé à chaque bénéficiaire (− collation), cycle suivant, clôture', async () => {
    const s = await startedTontine();
    const beneficiaries: string[] = [];
    for (let n = 1; n <= 3; n++) {
      const cycle = await ctx.prisma.tontineCycle.findUniqueOrThrow({
        where: { tontineId_number: { tontineId: s.tontineId, number: n } },
      });
      beneficiaries.push(cycle.beneficiaryId!);
      for (const u of s.users) expect((await payCurrent(s, u)).status).toBe(200);
      await settle();
      const done = await ctx.prisma.tontineCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      expect(done).toMatchObject({
        status: 'COMPLETED',
        payoutMinor: 29_000n,
        partialPayout: false,
      });
      if (n < 3) ctx.clock.advanceDays(28);
    }
    // chaque membre a été bénéficiaire exactement une fois (US-4.6 §5)
    expect(new Set(beneficiaries).size).toBe(3);
    // soldes : 100 000 − 3 × 10 000 + 29 000 = 99 000 pour chacun
    for (const u of s.users) expect((await ctx.balance(u.id)).balance).toBe(99_000n);
    const pool = await ctx.prisma.wallet.findFirstOrThrow({
      where: { tontineId: s.tontineId, ownerType: 'TONTINE_POOL' },
    });
    const reserve = await ctx.prisma.wallet.findFirstOrThrow({
      where: { tontineId: s.tontineId, ownerType: 'TONTINE_RESERVE' },
    });
    expect(pool.balanceMinor).toBe(0n);
    expect(reserve.balanceMinor).toBe(3_000n);
    const t = await ctx.prisma.tontine.findUniqueOrThrow({ where: { id: s.tontineId } });
    expect(t.status).toBe('COMPLETED');
    expect(t.archivedUntil!.getUTCFullYear()).toBe(t.completedAt!.getUTCFullYear() + 5);
    expect(await ctx.prisma.outboxEvent.count({ where: { eventType: 'tontine.closed' } })).toBe(1);
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'tontine.payout.initiated' } }),
    ).toBe(3);
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'tontine.cycle.started' } }),
    ).toBe(3);
    // notifications : bénéficiaire (« Vous avez reçu… ») et fin de cycle à tous
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: beneficiaries[0], templateKey: 'tontine.payout_received' },
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await ctx.prisma.notification.count({
        where: { templateKey: 'tontine.cycle_completed', channel: 'IN_APP' },
      }),
    ).toBeGreaterThanOrEqual(9);
    // grand livre cohérent
    const rec = await ctx.jobs.run('transactions.reconcile', 'test');
    expect(rec.summary['discrepancies']).toBe(0);
  });

  it('contributions incomplètes : pas de paiement automatique', async () => {
    const s = await startedTontine();
    await payCurrent(s, s.users[0]!);
    await payCurrent(s, s.users[1]!);
    await settle();
    const cycle = await ctx.prisma.tontineCycle.findUniqueOrThrow({
      where: { tontineId_number: { tontineId: s.tontineId, number: 1 } },
    });
    expect(cycle.status).toBe('IN_PROGRESS');
    expect(cycle.collectedMinor).toBe(20_000n);
  });
});

describe('US-4.5 — retards, pénalités, défauts, suspension', () => {
  it('échéance + grâce dépassée → LATE, pénalité 5 %, notification urgente ; paiement → PAID_LATE, pénalité en réserve', async () => {
    const s = await startedTontine();
    const late = s.users[2]!;
    for (const u of s.users.slice(0, 2)) await payCurrent(s, u);
    ctx.clock.set('2026-11-07T20:00:00.000Z'); // dernier jour de grâce : pas encore en retard
    expect((await ctx.jobs.run('tontines.late-detection', 'test')).summary['late']).toBe(0);
    ctx.clock.set('2026-11-08T09:00:00.000Z');
    expect((await ctx.jobs.run('tontines.late-detection', 'test')).summary['late']).toBe(1);
    const c = await ctx.prisma.contribution.findFirstOrThrow({
      where: { tontineId: s.tontineId, memberId: late.id },
    });
    expect(c).toMatchObject({ status: 'LATE', penaltyMinor: 500n });
    await settle();
    const notif = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: late.id, templateKey: 'tontine.contribution_late', channel: 'SMS' },
    });
    expect(notif.priority).toBe('URGENT');
    // tableau de bord admin : membre en retard
    const dash = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/dashboard`)
      .set(bearer(await ctx.token(s.admin)));
    expect(dash.body.lateMembers).toHaveLength(1);
    expect(dash.body.lateMembers[0]).toMatchObject({
      memberId: late.id,
      status: 'LATE',
      penalty: { amountMinor: '500' },
    });
    const pay = await payCurrent(s, late);
    expect(pay.body).toMatchObject({ status: 'PAID_LATE', penaltyPaid: true });
    expect((await ctx.balance(late.id)).balance).toBe(89_500n); // 10 000 + 500 de pénalité
    await settle();
    const reserve = await ctx.prisma.wallet.findFirstOrThrow({
      where: { tontineId: s.tontineId, ownerType: 'TONTINE_RESERVE' },
    });
    expect(reserve.balanceMinor).toBe(1_500n); // pénalité 500 + collation 1 000
    expect(
      (
        await ctx.prisma.tontineCycle.findFirstOrThrow({
          where: { tontineId: s.tontineId, number: 1 },
        })
      ).status,
    ).toBe('COMPLETED');
  });

  it('LATE → DEFAULTED après defaultAfterDays ; suspension après N défauts consécutifs', async () => {
    const s = await startedTontine({
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 1, defaultAfterDays: 7 },
    });
    const late = s.users[1]!;
    ctx.clock.set('2026-11-08T09:00:00.000Z');
    const r = await ctx.jobs.run('tontines.late-detection', 'test');
    expect(r.summary).toMatchObject({ late: 3, suspended: 3 });
    const m = await ctx.prisma.tontineMember.findFirstOrThrow({
      where: { tontineId: s.tontineId, memberId: late.id },
    });
    expect(m).toMatchObject({ status: 'SUSPENDED', consecutiveDefaults: 1 });
    ctx.clock.set('2026-11-15T09:00:00.000Z');
    expect((await ctx.jobs.run('tontines.late-detection', 'test')).summary['defaulted']).toBe(3);
    await settle();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: late.id, templateKey: 'tontine.member_suspended' },
      }),
    ).toBeGreaterThanOrEqual(1);
    // un membre suspendu peut régulariser ses arriérés
    expect((await payCurrent(s, late)).body.status).toBe('PAID_LATE');
  });
});

describe('US-4.7 §7 — politique en cas de contributions incomplètes (A-10)', () => {
  it('PARTIAL_PAYOUT : paiement partiel à l’échéance, arriérés reversés ensuite au bénéficiaire', async () => {
    const s = await startedTontine({ incompletePolicy: 'PARTIAL_PAYOUT' });
    const cycle = await ctx.prisma.tontineCycle.findFirstOrThrow({
      where: { tontineId: s.tontineId, number: 1 },
    });
    const debtor = s.users.find((u) => u.id !== cycle.beneficiaryId)!;
    for (const u of s.users.filter((x) => x.id !== debtor.id)) await payCurrent(s, u);
    await settle();
    ctx.clock.set('2026-11-08T09:00:00.000Z');
    const run = await ctx.jobs.run('tontines.payouts', 'test');
    expect(run.summary['partial']).toBe(1);
    const done = await ctx.prisma.tontineCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', partialPayout: true, payoutMinor: 19_000n });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'tontine.payout.partial' } })).toBe(
      1,
    );
    // le cycle 2 est ouvert malgré l'arriéré
    expect(await ctx.prisma.tontineCycle.count({ where: { tontineId: s.tontineId } })).toBe(2);
    const before = (await ctx.balance(cycle.beneficiaryId!)).balance;
    const c = await ctx.prisma.contribution.findFirstOrThrow({
      where: { cycleId: cycle.id, memberId: debtor.id },
    });
    await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/contributions/${c.id}/pay`)
      .set(bearer(await ctx.token(debtor)))
      .set('Idempotency-Key', randomUUID())
      .send()
      .expect(200);
    await settle();
    expect((await ctx.balance(cycle.beneficiaryId!)).balance - before).toBe(10_000n);
  });

  it('POSTPONE : le cycle attend ; l’admin peut forcer un paiement partiel motivé', async () => {
    const s = await startedTontine();
    const cycle = await ctx.prisma.tontineCycle.findFirstOrThrow({
      where: { tontineId: s.tontineId, number: 1 },
    });
    await payCurrent(s, s.users[0]!);
    await settle();
    ctx.clock.set('2026-11-10T09:00:00.000Z');
    const run = await ctx.jobs.run('tontines.payouts', 'test');
    expect(run.summary['postponed']).toBe(1);
    expect(
      (await ctx.prisma.tontineCycle.findUniqueOrThrow({ where: { id: cycle.id } })).status,
    ).toBe('IN_PROGRESS');
    const member = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/cycles/${cycle.id}/force-payout`)
      .set(bearer(await ctx.token(s.users[1]!)))
      .send({ reason: 'Je veux être payé' });
    expect(member.status).toBe(403);
    const forced = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/cycles/${cycle.id}/force-payout`)
      .set(bearer(await ctx.token(s.admin)))
      .send({ reason: 'Accord des membres en réunion' });
    expect(forced.status).toBe(200);
    expect(
      (await ctx.prisma.tontineCycle.findUniqueOrThrow({ where: { id: cycle.id } })).payoutMinor,
    ).toBe(9_000n);
    const blockers = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/closure-check`)
      .set(bearer(await ctx.token(s.admin)));
    expect(blockers.body.blockers.join(' ')).toContain('non payée');
  });
});

describe('pause / reprise (super-admin)', () => {
  it('pause : paiements suspendus ; reprise : paiements possibles', async () => {
    const s = await startedTontine();
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    const byAdmin = await ctx.http
      .post(`/api/v1/admin/tontines/${s.tontineId}/pause`)
      .set(bearer(await ctx.token(s.admin)))
      .send({ reason: 'Contrôle' });
    expect(byAdmin.status).toBe(403);
    expect(
      (
        await ctx.http
          .post(`/api/v1/admin/tontines/${s.tontineId}/pause`)
          .set(bearer(token))
          .send({ reason: 'Contrôle de conformité' })
      ).status,
    ).toBe(200);
    const blocked = await payCurrent(s, s.users[1]!);
    expect(blocked.status).toBe(422);
    expect(
      (
        await ctx.http
          .post(`/api/v1/admin/tontines/${s.tontineId}/resume`)
          .set(bearer(token))
          .send({ reason: 'Contrôle terminé' })
      ).status,
    ).toBe(200);
    expect((await payCurrent(s, s.users[1]!)).status).toBe(200);
  });
});

describe('US-4.10 — tableau de bord', () => {
  it('vue admin (agrégats) et vue membre (ses contributions, ses tours, pénalités)', async () => {
    const s = await startedTontine();
    await payCurrent(s, s.users[1]!);
    const admin = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/dashboard`)
      .set(bearer(await ctx.token(s.admin)));
    expect(admin.body).toMatchObject({
      role: 'ADMIN',
      refreshIntervalSeconds: 30,
      totalCollected: { amountMinor: '10000' },
      currentCycle: {
        number: 1,
        paidCount: 1,
        memberCount: 3,
        collected: { amountMinor: '10000' },
        remaining: { amountMinor: '20000' },
      },
    });
    const member = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/dashboard`)
      .set(bearer(await ctx.token(s.users[1]!)));
    expect(member.body.role).toBe('MEMBER');
    expect(member.body.myContributions).toHaveLength(1);
    expect(member.body.myContributions[0].status).toBe('PAID');
    expect(member.body).not.toHaveProperty('lateMembers');
    expect(member.body.myPenaltyBalance.amountMinor).toBe('0');
    const outsider = await ctx.createUser();
    expect(
      (
        await ctx.http
          .get(`/api/v1/tontines/${s.tontineId}/dashboard`)
          .set(bearer(await ctx.token(outsider)))
      ).status,
    ).toBe(404);
  });
});

describe('US-10.3 — messagerie ciblée', () => {
  it('envoi filtré (retardataires), historique, réservé à l’admin', async () => {
    const s = await startedTontine();
    await payCurrent(s, s.users[1]!);
    ctx.clock.set('2026-11-08T09:00:00.000Z');
    await ctx.jobs.run('tontines.late-detection', 'test');
    const token = await ctx.token(s.admin);
    const res = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/messages`)
      .set(bearer(token))
      .send({
        template: 'REMINDER',
        subject: 'Cotisation en retard',
        body: 'Merci de régulariser votre cotisation avant vendredi.',
        filter: { contributionStatus: 'LATE' },
      });
    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBe(1); // l'admin (expéditeur) est exclu, Bella a payé
    const n = await ctx.prisma.notification.findFirstOrThrow({
      where: { recipientId: s.users[2]!.id, templateKey: 'admin.message', channel: 'IN_APP' },
    });
    expect(n.title).toContain('Cotisation en retard');
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: s.users[1]!.id, templateKey: 'admin.message' },
      }),
    ).toBe(0);
    const history = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/messages`)
      .set(bearer(token));
    expect(history.body.data).toHaveLength(1);
    const byMember = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/messages`)
      .set(bearer(await ctx.token(s.users[1]!)))
      .send({ template: 'ANNOUNCEMENT', subject: 'Bonjour à tous', body: 'Message' });
    expect(byMember.status).toBe(403);
  });
});

describe('US-5.2 — solde et historique du wallet', () => {
  it('solde total / disponible / bloqué ; historique paginé par curseur, filtres, solde après opération', async () => {
    const s = await startedTontine();
    const u = s.users[1]!;
    await payCurrent(s, u);
    const token = await ctx.token(u);
    const w = await ctx.http.get('/api/v1/me/wallet').set(bearer(token));
    expect(w.body).toMatchObject({
      balance: { amountMinor: '90000' },
      available: { amountMinor: '90000' },
      blocked: { amountMinor: '0' },
    });
    const page1 = await ctx.http.get('/api/v1/me/wallet/movements?limit=2').set(bearer(token));
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.page.nextCursor).toBeTruthy();
    const page2 = await ctx.http
      .get(
        `/api/v1/me/wallet/movements?limit=2&cursor=${encodeURIComponent(page1.body.page.nextCursor)}`,
      )
      .set(bearer(token));
    const ids = [...page1.body.data, ...page2.body.data].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const debit = await ctx.http
      .get(`/api/v1/me/wallet/movements?type=DEBIT&tontineId=${s.tontineId}`)
      .set(bearer(token));
    expect(debit.body.data).toHaveLength(1);
    expect(debit.body.data[0]).toMatchObject({
      context: 'TONTINE_CONTRIBUTION',
      amount: { amountMinor: '10000' },
      balanceAfter: { amountMinor: '90000' },
      direction: 'OUT',
    });
    expect(debit.body.data[0].contextLabel).toMatch(/^Tontine /);
    const deposits = await ctx.http
      .get('/api/v1/me/wallet/movements?context=DEPOSIT')
      .set(bearer(token));
    expect(deposits.body.data.every((m: { context: string }) => m.context === 'DEPOSIT')).toBe(
      true,
    );
  });
});
