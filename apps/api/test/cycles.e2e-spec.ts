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

interface Setup {
  admin: TestUser;
  adminToken: string;
  members: TestUser[];
  tokens: Map<string, string>;
  tontineId: string;
}

/** Tontine de 3 membres (admin + 2 invités via lien), début le 2026-10-07, 1er mercredi du mois. */
async function setup(overrides: Record<string, unknown> = {}, extraMembers = 2): Promise<Setup> {
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
      maxMembers: 6,
      startDate: '2026-10-07',
      drawMode: 'RANDOM',
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 2 },
      ...overrides,
    });
  expect(res.status).toBe(201);
  const tontineId = res.body.id as string;
  const link = await ctx.http
    .post(`/api/v1/tontines/${tontineId}/invitations`)
    .set(bearer(adminToken))
    .send({ channel: 'LINK' });
  const members: TestUser[] = [];
  const tokens = new Map<string, string>([[admin.id, adminToken]]);
  for (let i = 0; i < extraMembers; i++) {
    const m = await ctx.createUser({ firstName: `Membre${i + 1}` });
    const token = await ctx.token(m);
    tokens.set(m.id, token);
    const acc = await ctx.http
      .post(`/api/v1/invitations/code/${link.body.code}/accept`)
      .set(bearer(token))
      .send();
    expect(acc.status).toBe(200);
    members.push(m);
  }
  await ctx.drain();
  return { admin, adminToken, members, tokens, tontineId };
}

/** Avance l'horloge au jour du démarrage (jetons d'accès renouvelés : TTL 15 min). */
async function toStartDate(s?: Setup): Promise<void> {
  ctx.clock.set('2026-10-07T08:00:00.000Z');
  if (s) s.adminToken = await ctx.token(s.admin);
}

describe('US-4.3 — démarrage automatique', () => {
  it('conditions non remplies : blocages listés et notifiés à l’admin, puis démarrage une fois levés', async () => {
    const s = await setup({ entryFee: '2000' });
    // avant la date : rien
    const early = await ctx.jobs.run('tontines.start', 'test');
    expect(early.summary).toMatchObject({ started: 0, blocked: 0 });
    await toStartDate(s);
    const blocked = await ctx.jobs.run('tontines.start', 'test');
    expect(blocked.summary['blocked']).toBe(1);
    const check = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/start-check`)
      .set(bearer(s.adminToken));
    expect(check.body.blockers.join(' ')).toContain('droit(s) d’entrée non payé(s)');
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: s.admin.id, templateKey: 'tontine.start_blocked' },
      }),
    ).toBeGreaterThanOrEqual(1);
    for (const u of [s.admin, ...s.members]) {
      await ctx.fund(u.id, 5_000n);
      const r = await ctx.http
        .post(`/api/v1/tontines/${s.tontineId}/entry-fee/pay`)
        .set(bearer(await ctx.token(u)))
        .set('Idempotency-Key', randomUUID())
        .send();
      expect(r.status).toBe(200);
    }
    const reserve = await ctx.prisma.wallet.findFirstOrThrow({
      where: { tontineId: s.tontineId, ownerType: 'TONTINE_RESERVE' },
    });
    expect(reserve.balanceMinor).toBe(6_000n);
    const run = await ctx.jobs.run('tontines.start', 'test');
    expect(run.summary['started']).toBe(1);
  });

  it('démarrage : ACTIVE, tirage Fisher-Yates prouvé, cycle 1, 3 échéances calculées, événements', async () => {
    const s = await setup();
    await toStartDate(s);
    await ctx.jobs.run('tontines.start', 'test');
    const t = await ctx.http.get(`/api/v1/tontines/${s.tontineId}`).set(bearer(s.adminToken));
    expect(t.body).toMatchObject({ status: 'ACTIVE', totalCycles: 3, currentCycleNumber: 1 });
    const proof = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/draw-proof`)
      .set(bearer(await ctx.token(s.members[0]!)));
    expect(proof.body).toMatchObject({
      drawMode: 'RANDOM',
      verified: true,
      algorithm: 'fisher-yates/sha256-ctr/v1',
    });
    expect(proof.body.proof).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.body.order).toHaveLength(3);
    const cycles = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles`)
      .set(bearer(s.adminToken));
    expect(cycles.body.data).toHaveLength(1);
    expect(cycles.body.data[0]).toMatchObject({
      number: 1,
      status: 'IN_PROGRESS',
      dueDate: '2026-11-04',
      memberCount: 3,
      paidCount: 0,
      expected: { amountMinor: '30000' },
    });
    expect(cycles.body.data[0].beneficiary.memberId).toBe(proof.body.order[0].memberId);
    expect(cycles.body.data[0].beneficiaryProof).toMatch(/^[0-9a-f]{64}$/);
    const contribs = await ctx.prisma.contribution.findMany({ where: { tontineId: s.tontineId } });
    expect(contribs).toHaveLength(3);
    expect(
      contribs.every(
        (c) => c.status === 'PENDING' && c.graceUntil.toISOString().startsWith('2026-11-07'),
      ),
    ).toBe(true);
    for (const type of ['tontine.started', 'tontine.cycle.started'])
      expect(await ctx.prisma.outboxEvent.count({ where: { eventType: type } })).toBe(1);
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'tontine.contribution.due' } }),
    ).toBe(3);
    // invitations closes après démarrage (A-06)
    const inv = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/invitations`)
      .set(bearer(s.adminToken))
      .send({ channel: 'LINK' });
    expect(inv.status).toBe(422);
    // US-4.4 §5 / US-8.4 : rappels J-3, J-1, J planifiés à 9 h (fuseau du membre)
    await ctx.drain();
    const reminders = await ctx.prisma.notification.findMany({
      where: {
        recipientId: s.members[0]!.id,
        templateKey: 'tontine.contribution_reminder',
        channel: 'SMS',
      },
      orderBy: { scheduledFor: 'asc' },
    });
    expect(reminders.map((r) => r.scheduledFor.toISOString())).toEqual([
      '2026-11-01T08:00:00.000Z',
      '2026-11-03T08:00:00.000Z',
      '2026-11-04T08:00:00.000Z',
    ]);
  });

  it('membre dont le KYC a baissé : démarrage bloqué', async () => {
    const s = await setup();
    await ctx.prisma.member.update({
      where: { id: s.members[0]!.id },
      data: { kycLevel: 'TIER_1' },
    });
    await toStartDate(s);
    const r = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/start`)
      .set(bearer(s.adminToken))
      .send();
    expect(r.body.started).toBe(false);
    expect(r.body.blockers.join(' ')).toContain('niveau 2');
  });

  it('démarrage manuel avant la date : refusé', async () => {
    const s = await setup();
    const r = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/start`)
      .set(bearer(s.adminToken))
      .send();
    expect(r.status).toBe(422);
  });
});

describe('US-4.6 — détermination du bénéficiaire', () => {
  it('FIXED_ORDER : ordre obligatoire, validé, puis seuls les passages futurs sont modifiables', async () => {
    const s = await setup({ drawMode: 'FIXED_ORDER' });
    await toStartDate(s);
    const blocked = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/start`)
      .set(bearer(s.adminToken))
      .send();
    expect(blocked.body.blockers.join(' ')).toContain('Ordre de passage');
    const [m1, m2] = s.members;
    const bad = await ctx.http
      .put(`/api/v1/tontines/${s.tontineId}/draw-order`)
      .set(bearer(s.adminToken))
      .send({ memberIds: [m1!.id, m2!.id, randomUUID()] });
    expect(bad.status).toBe(400);
    const order = [m2!.id, s.admin.id, m1!.id];
    const ok = await ctx.http
      .put(`/api/v1/tontines/${s.tontineId}/draw-order`)
      .set(bearer(s.adminToken))
      .send({ memberIds: order });
    expect(ok.status).toBe(200);
    const byMember = await ctx.http
      .put(`/api/v1/tontines/${s.tontineId}/draw-order`)
      .set(bearer(await ctx.token(m1!)))
      .send({ memberIds: order });
    expect(byMember.status).toBe(403);
    expect(
      (
        await ctx.http
          .post(`/api/v1/tontines/${s.tontineId}/start`)
          .set(bearer(s.adminToken))
          .send()
      ).body.started,
    ).toBe(true);
    const cycles = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles`)
      .set(bearer(s.adminToken));
    expect(cycles.body.data[0].beneficiary.memberId).toBe(m2!.id);
    // R-TON-08 : le 1er passage est figé
    const change = await ctx.http
      .put(`/api/v1/tontines/${s.tontineId}/draw-order`)
      .set(bearer(s.adminToken))
      .send({ memberIds: [m1!.id, s.admin.id, m2!.id] });
    expect(change.status).toBe(400);
    const future = await ctx.http
      .put(`/api/v1/tontines/${s.tontineId}/draw-order`)
      .set(bearer(s.adminToken))
      .send({ memberIds: [m1!.id, s.admin.id] });
    expect(future.status).toBe(200);
    expect(future.body.memberIds).toEqual([m2!.id, m1!.id, s.admin.id]);
  });

  it('PRIORITY_NEED : demande motivée, désignation par l’admin, jamais deux fois bénéficiaire', async () => {
    const s = await setup({ drawMode: 'PRIORITY_NEED' });
    const [m1] = s.members;
    const t1 = await ctx.token(m1!);
    const req = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/priority-requests`)
      .set(bearer(t1))
      .send({ reason: 'Frais de scolarité à régler en octobre' });
    expect(req.status).toBe(201);
    const dup = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/priority-requests`)
      .set(bearer(t1))
      .send({ reason: 'Frais de scolarité à régler en octobre' });
    expect(dup.status).toBe(409);
    await toStartDate(s);
    expect(
      (
        await ctx.http
          .post(`/api/v1/tontines/${s.tontineId}/start`)
          .set(bearer(s.adminToken))
          .send()
      ).body.started,
    ).toBe(true);
    const cycles = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles`)
      .set(bearer(s.adminToken));
    expect(cycles.body.data[0].beneficiary).toBeNull();
    const list = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/priority-requests`)
      .set(bearer(s.adminToken));
    expect(list.body.data[0]).toMatchObject({
      memberId: m1!.id,
      status: 'PENDING',
      firstName: 'Membre1',
    });
    const cycleId = cycles.body.data[0].id;
    const byMember = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/cycles/${cycleId}/beneficiary`)
      .set(bearer(await ctx.token(m1!)))
      .send({ memberId: m1!.id });
    expect(byMember.status).toBe(403);
    const ok = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/cycles/${cycleId}/beneficiary`)
      .set(bearer(s.adminToken))
      .send({ memberId: m1!.id });
    expect(ok.status).toBe(200);
    expect(ok.body.proof).toMatch(/^[0-9a-f]{64}$/);
    const again = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/cycles/${cycleId}/beneficiary`)
      .set(bearer(s.adminToken))
      .send({ memberId: s.members[1]!.id });
    expect(again.status).toBe(422);
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { templateKey: 'tontine.beneficiary_designated' },
      }),
    ).toBeGreaterThanOrEqual(3);
    expect(
      (await ctx.prisma.priorityRequest.findFirstOrThrow({ where: { memberId: m1!.id } })).status,
    ).toBe('SELECTED');
  });
});

describe('US-5.4 / US-5.5 — paiement des contributions depuis le wallet', () => {
  async function started() {
    const s = await setup();
    await toStartDate(s);
    await ctx.jobs.run('tontines.start', 'test');
    const m = s.members[0]!;
    const token = await ctx.token(m);
    const c = await ctx.prisma.contribution.findFirstOrThrow({
      where: { tontineId: s.tontineId, memberId: m.id },
    });
    return { ...s, m, token, contributionId: c.id };
  }
  const pay = (s: { tontineId: string }, token: string, cid: string, key = randomUUID()) =>
    ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/contributions/${cid}/pay`)
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send();

  it('nominal : hold capturé, débit membre, crédit cagnotte, PAID, événement, cycle mis à jour', async () => {
    const s = await started();
    await ctx.fund(s.m.id, 25_000n);
    const res = await pay(s, s.token, s.contributionId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'PAID',
      amount: { amountMinor: '10000' },
      cycleNumber: 1,
    });
    expect(await ctx.balance(s.m.id)).toEqual({ balance: 15_000n, blocked: 0n });
    const pool = await ctx.prisma.wallet.findFirstOrThrow({
      where: { tontineId: s.tontineId, ownerType: 'TONTINE_POOL' },
    });
    expect(pool.balanceMinor).toBe(10_000n);
    const hold = await ctx.prisma.walletHold.findFirstOrThrow({
      where: { referenceId: s.contributionId },
    });
    expect(hold.status).toBe('CAPTURED');
    expect(
      await ctx.prisma.outboxEvent.count({ where: { eventType: 'tontine.contribution.received' } }),
    ).toBe(1);
    const cycle = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles`)
      .set(bearer(s.adminToken));
    expect(cycle.body.data[0]).toMatchObject({ paidCount: 1, collected: { amountMinor: '10000' } });
    // US-8.4 : rappels annulés après paiement
    await ctx.drain();
    const pending = await ctx.prisma.notification.count({
      where: {
        recipientId: s.m.id,
        templateKey: 'tontine.contribution_reminder',
        status: 'PENDING',
      },
    });
    expect(pending).toBe(0);
    // compte principal (US-10.2) = cagnotte
    const accounts = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/accounts`)
      .set(bearer(s.adminToken));
    expect(accounts.body.data[0]).toMatchObject({
      type: 'MAIN',
      functional: true,
      balance: { amountMinor: '10000' },
    });
  });

  it('double débit impossible : même clé, autre clé, requêtes concurrentes', async () => {
    const s = await started();
    await ctx.fund(s.m.id, 50_000n);
    const key = randomUUID();
    const results = await Promise.all([
      pay(s, s.token, s.contributionId, key),
      pay(s, s.token, s.contributionId),
      pay(s, s.token, s.contributionId),
    ]);
    expect(results.some((r) => r.status === 200)).toBe(true);
    await pay(s, s.token, s.contributionId, key);
    await pay(s, s.token, s.contributionId);
    expect((await ctx.balance(s.m.id)).balance).toBe(40_000n);
    expect((await ctx.balance(s.m.id)).blocked).toBe(0n);
    expect(
      await ctx.prisma.transaction.count({ where: { type: 'CONTRIBUTION', status: 'COMPLETED' } }),
    ).toBe(1);
  });

  it('solde insuffisant : 422, aucun hold actif, wallet.debit.failed + notification', async () => {
    const s = await started();
    await ctx.fund(s.m.id, 3_000n);
    const res = await pay(s, s.token, s.contributionId);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await ctx.prisma.walletHold.count({ where: { status: 'ACTIVE' } })).toBe(0);
    await ctx.drain();
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: s.m.id, templateKey: 'wallet.debit_failed' },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('isolation : impossible de payer la contribution d’un autre membre', async () => {
    const s = await started();
    await ctx.fund(s.members[1]!.id, 50_000n);
    const res = await pay(s, await ctx.token(s.members[1]!), s.contributionId);
    expect(res.status).toBe(404);
  });

  it('échéances du membre et vue du cycle limitée à sa contribution', async () => {
    const s = await started();
    const mine = await ctx.http.get('/api/v1/me/contributions').set(bearer(s.token));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      status: 'PENDING',
      dueDate: '2026-11-04',
      totalDue: { amountMinor: '10000' },
    });
    const cycleId = mine.body.data[0].cycleId;
    const memberView = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles/${cycleId}`)
      .set(bearer(s.token));
    expect(memberView.body.contributions).toHaveLength(1);
    expect(memberView.body.memberCount).toBe(3);
    const adminView = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles/${cycleId}`)
      .set(bearer(s.adminToken));
    expect(adminView.body.contributions).toHaveLength(3);
    expect(adminView.body.contributions[0].memberName).toBeTruthy();
  });
});

describe('US-10.2 — comptes de la tontine', () => {
  it('compte principal automatique ; comptes complémentaires configurables par l’admin uniquement', async () => {
    const s = await setup();
    const create = await ctx.http
      .post(`/api/v1/tontines/${s.tontineId}/accounts`)
      .set(bearer(s.adminToken))
      .send({
        name: 'Caisse de solidarité',
        type: 'SOLIDARITY',
        rules: { exitConditions: 'Décès ou maladie grave' },
      });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ functional: false, balance: null });
    expect(
      (
        await ctx.http
          .post(`/api/v1/tontines/${s.tontineId}/accounts`)
          .set(bearer(s.adminToken))
          .send({ name: 'Autre solidarité', type: 'SOLIDARITY' })
      ).status,
    ).toBe(409);
    expect(
      (
        await ctx.http
          .post(`/api/v1/tontines/${s.tontineId}/accounts`)
          .set(bearer(s.adminToken))
          .send({ name: 'Principal 2', type: 'MAIN' })
      ).status,
    ).toBe(409);
    expect(
      (
        await ctx.http
          .post(`/api/v1/tontines/${s.tontineId}/accounts`)
          .set(bearer(await ctx.token(s.members[0]!)))
          .send({ name: 'Épargne', type: 'SAVINGS' })
      ).status,
    ).toBe(403);
    const list = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/accounts`)
      .set(bearer(s.adminToken));
    expect(list.body.data.map((a: { type: string }) => a.type)).toEqual(['MAIN', 'SOLIDARITY']);
  });
});
