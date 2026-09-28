import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { START, type TestContext, bearer, createTestContext } from './support/test-app';
import { payCurrent, runToCompletion, settle, startTontine } from './support/tontine';

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

async function firstCycle(tontineId: string) {
  return ctx.prisma.tontineCycle.findUniqueOrThrow({
    where: { tontineId_number: { tontineId, number: 1 } },
  });
}

describe('member.payout.due', () => {
  it('émis à l’ouverture de chaque cycle pour son bénéficiaire, avec montant attendu et échéance', async () => {
    const s = await startTontine(ctx);
    const cycle = await firstCycle(s.tontineId);
    const evt = await ctx.prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'member.payout.due', aggregateId: s.tontineId },
    });
    expect(evt.payload).toEqual({
      memberId: cycle.beneficiaryId,
      tontineId: s.tontineId,
      cycleId: cycle.id,
      cycleNumber: 1,
      dueDate: cycle.dueDate.toISOString().slice(0, 10),
      expectedMinor: '30000',
      currency: 'XAF',
    });

    await runToCompletion(ctx, s);
    await settle(ctx);
    const all = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'member.payout.due', aggregateId: s.tontineId },
    });
    const beneficiaries = all.map((e) => (e.payload as { memberId: string }).memberId);
    expect(all).toHaveLength(s.users.length);
    expect(new Set(beneficiaries)).toEqual(new Set(s.users.map((u) => u.id)));
  });
});

describe('Routes à plat /cycles', () => {
  it('GET /cycles?tontineId et GET /cycles/:id équivalents aux routes imbriquées', async () => {
    const s = await startTontine(ctx);
    const token = await ctx.token(s.admin);
    const cycle = await firstCycle(s.tontineId);
    const flat = await ctx.http.get(`/api/v1/cycles?tontineId=${s.tontineId}`).set(bearer(token));
    const nested = await ctx.http.get(`/api/v1/tontines/${s.tontineId}/cycles`).set(bearer(token));
    expect(flat.status).toBe(200);
    expect(flat.body).toEqual(nested.body);
    const one = await ctx.http.get(`/api/v1/cycles/${cycle.id}`).set(bearer(token));
    expect(one.body).toEqual(
      (await ctx.http.get(`/api/v1/tontines/${s.tontineId}/cycles/${cycle.id}`).set(bearer(token)))
        .body,
    );
    expect((await ctx.http.get('/api/v1/cycles').set(bearer(token))).status).toBe(400);
    expect((await ctx.http.get(`/api/v1/cycles/${randomUUID()}`).set(bearer(token))).status).toBe(
      404,
    );
  });

  it('contributions : l’admin voit tout, un membre la sienne ; filtre par statut', async () => {
    const s = await startTontine(ctx);
    const [admin, bella] = s.users;
    const cycle = await firstCycle(s.tontineId);
    expect((await payCurrent(ctx, s, bella!)).status).toBe(202);
    await settle(ctx);

    const all = await ctx.http
      .get(`/api/v1/cycles/${cycle.id}/contributions`)
      .set(bearer(await ctx.token(admin!)));
    expect(all.body.data).toHaveLength(3);
    const paid = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles/${cycle.id}/contributions?status=PAID`)
      .set(bearer(await ctx.token(admin!)));
    expect(paid.body.data.map((c: { memberId: string }) => c.memberId)).toEqual([bella!.id]);

    const mine = await ctx.http
      .get(`/api/v1/cycles/${cycle.id}/contributions`)
      .set(bearer(await ctx.token(bella!)));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ memberId: bella!.id, status: 'PAID' });
    expect(mine.body.data[0].memberName).toBeUndefined();

    const bad = await ctx.http
      .get(`/api/v1/cycles/${cycle.id}/contributions?status=NOPE`)
      .set(bearer(await ctx.token(admin!)));
    expect(bad.status).toBe(400);
  });

  it('bénéficiaire : visible des participants avec preuve ; versement après clôture du cycle', async () => {
    const s = await startTontine(ctx);
    const cycle = await firstCycle(s.tontineId);
    const token = await ctx.token(s.users[1]!);
    const before = await ctx.http.get(`/api/v1/cycles/${cycle.id}/beneficiary`).set(bearer(token));
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      number: 1,
      beneficiary: { memberId: cycle.beneficiaryId },
      mode: 'RANDOM',
      proof: cycle.beneficiaryProof,
      payout: null,
      paidOut: false,
    });
    for (const u of s.users) expect((await payCurrent(ctx, s, u)).status).toBe(202);
    await settle(ctx);
    const after = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/cycles/${cycle.id}/beneficiary`)
      .set(bearer(token));
    expect(after.body.paidOut).toBe(true);
    expect(after.body.payout).not.toBeNull();
  });

  it('un non-participant est refusé ; cycle d’une autre tontine via route imbriquée → 404', async () => {
    const s = await startTontine(ctx);
    ctx.clock.set(START);
    const other = await startTontine(ctx, {}, ['Dora', 'Eli']);
    const cycle = await firstCycle(s.tontineId);
    const outsider = await ctx.createUser();
    const res = await ctx.http
      .get(`/api/v1/cycles/${cycle.id}/beneficiary`)
      .set(bearer(await ctx.token(outsider)));
    expect([403, 404]).toContain(res.status);
    const cross = await ctx.http
      .get(`/api/v1/tontines/${other.tontineId}/cycles/${cycle.id}/contributions`)
      .set(bearer(await ctx.token(other.admin)));
    expect(cross.status).toBe(404);
    const badId = await ctx.http
      .get(`/api/v1/tontines/not-a-uuid/cycles/${cycle.id}/beneficiary`)
      .set(bearer(await ctx.token(s.admin)));
    expect(badId.status).toBe(400);
  });
});

describe('Vue tontine : cycle en cours (A-58)', () => {
  it('GET /tontines et /tontines/:id exposent le cycle en cours, mis à jour après paiement', async () => {
    const s = await startTontine(ctx);
    const [, bella] = s.users;
    const cycle = await firstCycle(s.tontineId);
    const token = await ctx.token(bella!);
    const expected = {
      number: 1,
      status: cycle.status,
      dueDate: cycle.dueDate.toISOString().slice(0, 10),
      beneficiary: { memberId: cycle.beneficiaryId, firstName: expect.any(String) },
      paidCount: 0,
      memberCount: 3,
    };
    const one = await ctx.http.get(`/api/v1/tontines/${s.tontineId}`).set(bearer(token));
    expect(one.body.currentCycle).toEqual(expected);
    const list = await ctx.http.get('/api/v1/tontines').set(bearer(token));
    expect(list.body.data.find((t: { id: string }) => t.id === s.tontineId).currentCycle).toEqual(
      expected,
    );

    expect((await payCurrent(ctx, s, bella!)).status).toBe(202);
    await settle(ctx);
    const after = await ctx.http.get(`/api/v1/tontines/${s.tontineId}`).set(bearer(token));
    expect(after.body.currentCycle.paidCount).toBe(1);
  });

  it('null tant que la tontine n’a pas démarré', async () => {
    const s = await startTontine(ctx);
    await ctx.prisma.tontine.update({
      where: { id: s.tontineId },
      data: { currentCycleNumber: null },
    });
    const res = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}`)
      .set(bearer(await ctx.token(s.admin)));
    expect(res.body.currentCycle).toBeNull();
  });
});
