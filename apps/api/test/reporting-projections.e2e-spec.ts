import { randomUUID } from 'node:crypto';
import { ProjectionService, ReportsService } from '@tontine/reporting';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, createTestContext } from './support/test-app';
import { startTontine } from './support/tontine';

/** Étape 6 (A-54) : instantanés publiés par déclencheurs et projections du reporting. */
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

const snapshots = (eventType: string, aggregateId: string) =>
  ctx.prisma.outboxEvent.findMany({
    where: { eventType, aggregateId },
    orderBy: { seq: 'asc' },
  });

describe('Instantanés publiés par les domaines (déclencheurs)', () => {
  it('même transaction que l’écriture ; colonnes explicites, montants exacts en texte, aucune donnée personnelle', async () => {
    const u = await ctx.createUser({ firstName: 'Zebulon', lastName: 'Secret' });
    const member = await snapshots('member.snapshot', u.id);
    expect(member).toHaveLength(1);
    expect(Object.keys(member[0]!.payload as object).sort()).toEqual(
      ['capturedAt', 'deleted', 'id', 'kycLevel', 'sourceVersion', 'status'].sort(),
    );
    expect(JSON.stringify(member[0]!.payload)).not.toContain('Zebulon');
    expect(member[0]).toMatchObject({ producer: 'members', eventVersion: 1 });

    await ctx.fund(u.id, 12_345n);
    const w = await ctx.prisma.wallet.findUniqueOrThrow({ where: { memberId: u.id } });
    const last = (await snapshots('wallet.snapshot', w.id)).at(-1)!;
    expect(last.payload).toMatchObject({
      balanceMinor: '12345',
      blockedMinor: '0',
      currency: 'XAF',
    });
  });

  it('modification d’une colonne non publiée : aucun instantané', async () => {
    const u = await ctx.createUser();
    const before = (await snapshots('member.snapshot', u.id)).length;
    await ctx.prisma.member.update({ where: { id: u.id }, data: { city: 'Douala' } });
    expect(await snapshots('member.snapshot', u.id)).toHaveLength(before);
    await ctx.prisma.member.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
    expect(await snapshots('member.snapshot', u.id)).toHaveLength(before + 1);
  });

  it('les projections sont reconstruites à partir des seuls événements', async () => {
    const s = await startTontine(ctx);
    await ctx.drain();
    const t = await ctx.prisma.tontine.findUniqueOrThrow({ where: { id: s.tontineId } });
    const rpt = await ctx.prisma.rptTontine.findUniqueOrThrow({ where: { id: s.tontineId } });
    expect(rpt).toMatchObject({
      name: t.name,
      status: t.status,
      currency: t.currency,
      contributionMinor: t.contributionMinor,
      totalCycles: t.totalCycles,
    });
    expect(await ctx.prisma.rptContribution.count({ where: { tontineId: s.tontineId } })).toBe(
      await ctx.prisma.contribution.count({ where: { tontineId: s.tontineId } }),
    );
    expect(await ctx.prisma.rptTontineMember.count({ where: { tontineId: s.tontineId } })).toBe(3);
  });
});

describe('Projection : ordre, idempotence, suppression', () => {
  const base = (sourceVersion: string, status: string) => ({
    id: randomUUID(),
    status,
    kycLevel: 'TIER_1',
    deleted: false,
    capturedAt: '2026-09-24T09:00:00.000Z',
    sourceVersion,
  });

  it('un instantané plus ancien (désordre, redélivrance) ne remplace pas un plus récent', async () => {
    const p = ctx.app.get(ProjectionService);
    const newer = base('2000', 'SUSPENDED');
    await p.apply('member.snapshot', newer);
    await p.apply('member.snapshot', { ...newer, status: 'ACTIVE', sourceVersion: '1000' });
    await p.apply('member.snapshot', newer);
    expect(await ctx.prisma.rptMember.findUniqueOrThrow({ where: { id: newer.id } })).toMatchObject(
      { status: 'SUSPENDED', sourceVersion: 2000n },
    );
  });

  it('suppression : n’efface qu’un état plus ancien', async () => {
    const p = ctx.app.get(ProjectionService);
    const row = base('3000', 'ACTIVE');
    await p.apply('member.snapshot', row);
    await p.apply('member.snapshot', { ...row, deleted: true, sourceVersion: '2000' });
    expect(await ctx.prisma.rptMember.count({ where: { id: row.id } })).toBe(1);
    await p.apply('member.snapshot', { ...row, deleted: true, sourceVersion: '4000' });
    expect(await ctx.prisma.rptMember.count({ where: { id: row.id } })).toBe(0);
  });

  it('fait en ajout seul : inséré une seule fois', async () => {
    const p = ctx.app.get(ProjectionService);
    const v = {
      id: randomUUID(),
      ruleCode: 'CM-DAILY',
      action: 'BLOCKED',
      operationType: 'TRANSFER',
      createdAt: '2026-09-24T09:00:00.000Z',
      capturedAt: '2026-09-24T09:00:00.000Z',
      sourceVersion: '1',
    };
    await p.apply('compliance.violation.recorded', v);
    await p.apply('compliance.violation.recorded', v);
    expect(await ctx.prisma.rptViolation.count({ where: { id: v.id } })).toBe(1);
  });
});

describe('Rapport final', () => {
  it('projections incomplètes : archivage différé (redélivrance), rien d’archivé', async () => {
    const s = await startTontine(ctx);
    await ctx.drain();
    await expect(ctx.app.get(ReportsService).archiveFinalReport(s.tontineId)).rejects.toThrow(
      /incomplètes/,
    );
    expect(await ctx.prisma.generatedReport.count()).toBe(0);
  });
});
