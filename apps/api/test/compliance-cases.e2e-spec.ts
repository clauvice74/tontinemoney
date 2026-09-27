import { randomUUID } from 'node:crypto';
import { OutboxService, UnitOfWork } from '@tontine/platform';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, bearer, createTestContext } from './support/test-app';

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

async function agentToken() {
  return ctx.token(await ctx.createUser({ role: 'KYC_AGENT' }));
}

/** Publie une violation comme le ferait ComplianceService.validate. */
async function emitViolation(memberId: string, violationId = randomUUID()) {
  const outbox = ctx.app.get(OutboxService);
  await ctx.app.get(UnitOfWork).run((tx) =>
    outbox.add(tx, {
      type: 'compliance.violation.detected',
      aggregateType: 'member',
      aggregateId: memberId,
      payload: {
        violationId,
        memberId,
        operationType: 'DEPOSIT',
        ruleCode: 'CM-DAILY-LIMIT',
        action: 'BLOCK',
      },
    }),
  );
  return violationId;
}

describe('Screening à la demande — /aml/check, /sanctions/check, /pep/check', () => {
  it('PEP : nouvelle correspondance persistée (ON_DEMAND) et dossier AML ouvert ; pas de doublon au 2e passage', async () => {
    const token = await agentToken();
    const m = await ctx.createUser({ firstName: 'Paul', lastName: 'Expose' });

    const pep = await ctx.http
      .post('/api/v1/pep/check')
      .set(bearer(token))
      .send({ memberId: m.id });
    expect(pep.status).toBe(200);
    expect(pep.body).toMatchObject({ scope: 'PEP', clear: false, newMatches: 1 });
    expect(pep.body.hits[0]).toMatchObject({ listName: 'PEP', isNew: true, status: 'OPEN' });
    expect(
      await ctx.prisma.kycAmlMatch.count({ where: { memberId: m.id, source: 'ON_DEMAND' } }),
    ).toBe(1);

    await ctx.drain();
    const c = await ctx.prisma.complianceCase.findFirstOrThrow({ where: { memberId: m.id } });
    expect(c).toMatchObject({ type: 'AML_SCREENING', status: 'OPEN', severity: 'MEDIUM' });
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'compliance.case.opened', aggregateId: c.id },
      }),
    ).toBe(1);

    const again = await ctx.http
      .post('/api/v1/aml/check')
      .set(bearer(token))
      .send({ memberId: m.id });
    expect(again.body).toMatchObject({ scope: 'ALL', newMatches: 0 });
    expect(again.body.hits[0].isNew).toBe(false);
    expect(await ctx.prisma.kycAmlMatch.count({ where: { memberId: m.id } })).toBe(1);
  });

  it('sanctions exclut la liste PEP ; membre sans correspondance → clear', async () => {
    const token = await agentToken();
    const pepOnly = await ctx.createUser({ firstName: 'Paul', lastName: 'Expose' });
    const res = await ctx.http
      .post('/api/v1/sanctions/check')
      .set(bearer(token))
      .send({ memberId: pepOnly.id });
    expect(res.body).toMatchObject({ scope: 'SANCTIONS', clear: true, hits: [] });
    const ofac = await ctx.createUser({ firstName: 'Viktor', lastName: 'Contrebandier' });
    const hit = await ctx.http
      .post('/api/v1/sanctions/check')
      .set(bearer(token))
      .send({ memberId: ofac.id });
    expect(hit.body.hits[0].listName).toBe('OFAC');
    await ctx.drain();
    expect(
      await ctx.prisma.complianceCase.findFirstOrThrow({ where: { memberId: ofac.id } }),
    ).toMatchObject({ severity: 'CRITICAL' });
  });

  it('journalisé ; membre inconnu → 404 ; interdit aux membres ; champ inconnu → 400', async () => {
    const token = await agentToken();
    const m = await ctx.createUser();
    await ctx.http
      .post('/api/v1/aml/check')
      .set(bearer(token))
      .send({ memberId: m.id })
      .expect(200);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'kyc.screening.on_demand', resourceId: m.id },
      }),
    ).toBe(1);
    await ctx.http
      .post('/api/v1/aml/check')
      .set(bearer(token))
      .send({ memberId: randomUUID() })
      .expect(404);
    await ctx.http
      .post('/api/v1/aml/check')
      .set(bearer(token))
      .send({ memberId: m.id, name: 'x' })
      .expect(400);
    await ctx.http
      .post('/api/v1/aml/check')
      .set(bearer(await ctx.token(m)))
      .send({ memberId: m.id })
      .expect(403);
  });
});

describe('Dossiers de conformité — /compliance/cases', () => {
  it('clôture refusée tant que la correspondance AML est ouverte ; acceptée après la revue', async () => {
    const token = await agentToken();
    const m = await ctx.createUser({ firstName: 'Viktor', lastName: 'Contrebandier' });
    const screening = await ctx.http
      .post('/api/v1/aml/check')
      .set(bearer(token))
      .send({ memberId: m.id });
    await ctx.drain();
    const { id } = await ctx.prisma.complianceCase.findFirstOrThrow({ where: { memberId: m.id } });

    const detail = await ctx.http.get(`/api/v1/compliance/cases/${id}`).set(bearer(token));
    expect(detail.body.alerts).toEqual([
      expect.objectContaining({
        alertType: 'AML_MATCH',
        sourceId: screening.body.hits[0].matchId,
        open: true,
      }),
    ]);

    const blocked = await ctx.http
      .post(`/api/v1/compliance/cases/${id}/close`)
      .set(bearer(token))
      .send({ outcome: 'DISMISSED', comment: 'Homonyme' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.openAlerts).toHaveLength(1);

    await ctx.http
      .post(`/api/v1/kyc/aml-matches/${screening.body.hits[0].matchId}/resolve`)
      .set(bearer(token))
      .send({ resolution: 'FALSE_POSITIVE', comment: 'Homonyme, date de naissance différente' })
      .expect(204);
    await ctx.drain();

    const closed = await ctx.http
      .post(`/api/v1/compliance/cases/${id}/close`)
      .set(bearer(token))
      .send({ outcome: 'DISMISSED', comment: 'Faux positif confirmé' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', outcome: 'DISMISSED' });
    expect(closed.body.alerts[0].open).toBe(false);
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { eventType: 'compliance.case.closed', aggregateId: id },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'compliance.case.closed', resourceId: id },
      }),
    ).toBe(1);

    const twice = await ctx.http
      .post(`/api/v1/compliance/cases/${id}/close`)
      .set(bearer(token))
      .send({ outcome: 'CONFIRMED', comment: 'Autre' });
    expect(twice.status).toBe(422);
  });

  it('violations : un seul dossier, gravité croissante, idempotent au rejeu ; nouveau dossier après clôture', async () => {
    const token = await agentToken();
    const m = await ctx.createUser();
    const first = await emitViolation(m.id);
    await emitViolation(m.id);
    await ctx.drain();
    let c = await ctx.prisma.complianceCase.findFirstOrThrow({ where: { memberId: m.id } });
    expect(c).toMatchObject({ type: 'RULE_VIOLATION', severity: 'LOW' });

    await emitViolation(m.id, first); // rejeu de la même violation
    await emitViolation(m.id);
    await ctx.drain();
    c = await ctx.prisma.complianceCase.findFirstOrThrow({ where: { memberId: m.id } });
    expect(c.severity).toBe('MEDIUM');
    expect(await ctx.prisma.complianceCaseAlert.count({ where: { caseId: c.id } })).toBe(3);

    await ctx.http
      .post(`/api/v1/compliance/cases/${c.id}/close`)
      .set(bearer(token))
      .send({ outcome: 'CONFIRMED', comment: 'Plafond dépassé, membre informé' })
      .expect(200);
    await emitViolation(m.id);
    await ctx.drain();
    expect(await ctx.prisma.complianceCase.count({ where: { memberId: m.id } })).toBe(2);
    expect(
      await ctx.prisma.complianceCase.count({ where: { memberId: m.id, status: 'OPEN' } }),
    ).toBe(1);
  });

  it('signalement de fraude → dossier FRAUD critique, clôturable sans lever la suspension', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    const m = await ctx.createUser();
    await ctx.http
      .post('/api/v1/admin/fraud/flag')
      .set(bearer(token))
      .send({ memberId: m.id, reason: 'Comptes multiples' })
      .expect(202);
    await ctx.drain();
    const c = await ctx.prisma.complianceCase.findFirstOrThrow({ where: { memberId: m.id } });
    expect(c).toMatchObject({ type: 'FRAUD', severity: 'CRITICAL' });
    await ctx.http
      .post(`/api/v1/compliance/cases/${c.id}/close`)
      .set(bearer(token))
      .send({ outcome: 'CONFIRMED', comment: 'Fraude avérée' })
      .expect(200);
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      'SUSPENDED',
    );
  });

  it('liste : filtres, pagination sans doublon ; réservée au personnel', async () => {
    const token = await agentToken();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const m = await ctx.createUser();
      await emitViolation(m.id);
      ids.push(m.id);
    }
    const dup = await ctx.createUser();
    await emitViolation(dup.id);
    await ctx.drain();

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: {
        body: {
          data: Array<{ memberId: string; alertCount: number }>;
          page: { nextCursor: string | null };
        };
      } = await ctx.http
        .get(
          `/api/v1/compliance/cases?type=RULE_VIOLATION&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        )
        .set(bearer(token));
      seen.push(...res.body.data.map((r) => r.memberId));
      expect(res.body.data.every((r) => r.alertCount === 1)).toBe(true);
      cursor = res.body.page.nextCursor;
    } while (cursor);
    expect(new Set(seen)).toEqual(new Set([...ids, dup.id]));
    expect(seen).toHaveLength(4);

    const byMember = await ctx.http
      .get(`/api/v1/compliance/cases?memberId=${dup.id}&status=OPEN`)
      .set(bearer(token));
    expect(byMember.body.data).toHaveLength(1);

    const member = await ctx.createUser();
    await ctx.http
      .get('/api/v1/compliance/cases')
      .set(bearer(await ctx.token(member)))
      .expect(403);
    await ctx.http.get(`/api/v1/compliance/cases/${randomUUID()}`).set(bearer(token)).expect(404);
  });
});

describe('Score de risque — /risk-score et /fraud/analyze', () => {
  it('membre vérifié sans alerte : 0 / LOW ; journalisé', async () => {
    const token = await agentToken();
    const m = await ctx.createUser({ kycLevel: 'TIER_3' });
    const res = await ctx.http
      .post('/api/v1/risk-score')
      .set(bearer(token))
      .send({ memberId: m.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ memberId: m.id, score: 0, level: 'LOW', factors: [] });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'compliance.risk.scored', resourceId: m.id },
      }),
    ).toBe(1);
  });

  it('dossier ouvert et violations récentes font monter le score ; alias identique', async () => {
    const token = await agentToken();
    const m = await ctx.createUser({
      kycLevel: 'TIER_1',
      firstName: 'Viktor',
      lastName: 'Contrebandier',
    });
    await ctx.http.post('/api/v1/aml/check').set(bearer(token)).send({ memberId: m.id });
    await ctx.drain();
    const res = await ctx.http
      .post('/api/v1/risk-score')
      .set(bearer(token))
      .send({ memberId: m.id });
    expect(res.body.factors.map((f: { code: string }) => f.code)).toEqual([
      'OPEN_CASE_AML_SCREENING',
      'KYC_LEVEL',
    ]);
    expect(res.body).toMatchObject({ score: 65, level: 'HIGH' });
    const alias = await ctx.http
      .post('/api/v1/fraud/analyze')
      .set(bearer(token))
      .send({ memberId: m.id });
    expect(alias.body.score).toBe(65);
  });

  it('membre inconnu → 404 ; interdit aux membres', async () => {
    const token = await agentToken();
    await ctx.http
      .post('/api/v1/risk-score')
      .set(bearer(token))
      .send({ memberId: randomUUID() })
      .expect(404);
    const m = await ctx.createUser();
    await ctx.http
      .post('/api/v1/risk-score')
      .set(bearer(await ctx.token(m)))
      .send({ memberId: m.id })
      .expect(403);
  });
});
