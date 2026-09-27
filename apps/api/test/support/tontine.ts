import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { type TestContext, type TestUser, bearer } from './test-app';

export interface StartedTontine {
  admin: TestUser;
  users: TestUser[];
  tontineId: string;
}

/** Tontine de 3 membres démarrée le 2026-10-07 (contribution 10 000 XAF, collation 1 000), wallets alimentés. */
export async function startTontine(
  ctx: TestContext,
  overrides: Record<string, unknown> = {},
  names = ['Bella', 'Carl'],
): Promise<StartedTontine> {
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
      maxMembers: names.length + 1,
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
  for (const firstName of names) {
    const u = await ctx.createUser({ firstName });
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
  for (const u of users) await ctx.fund(u.id, 100_000n);
  return { admin, users, tontineId };
}

export async function payCurrent(ctx: TestContext, s: StartedTontine, user: TestUser) {
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

export async function settle(ctx: TestContext): Promise<void> {
  for (let i = 0; i < 4; i++) await ctx.drain();
}

/** Déroule tous les cycles jusqu'à la clôture. */
export async function runToCompletion(ctx: TestContext, s: StartedTontine): Promise<void> {
  for (let n = 1; n <= s.users.length; n++) {
    for (const u of s.users) expect((await payCurrent(ctx, s, u)).status).toBe(202);
    await settle(ctx);
    if (n < s.users.length) ctx.clock.advanceDays(28);
  }
}
