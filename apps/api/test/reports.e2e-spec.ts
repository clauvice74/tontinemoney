import { createHash, randomUUID } from 'node:crypto';
import { ProviderRegistry } from '@tontine/payments';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, bearer, createTestContext } from './support/test-app';
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

/** supertest : lecture binaire des réponses PDF. */
function binary(
  res: NodeJS.ReadableStream & {
    setEncoding(e: string): void;
    on(ev: string, cb: (c?: unknown) => void): void;
  },
  cb: (err: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(Buffer.from(c as Buffer)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('US-4.9 — rapport final de clôture', () => {
  it('PDF généré automatiquement et archivé (5 ans), restitué à l’identique', async () => {
    const s = await startTontine(ctx);
    await runToCompletion(ctx, s);
    await settle(ctx);
    const stored = await ctx.prisma.generatedReport.findFirstOrThrow({
      where: { tontineId: s.tontineId, kind: 'FINAL' },
    });
    expect(Buffer.from(stored.content).subarray(0, 5).toString()).toBe('%PDF-');
    expect(stored.retainUntil.getUTCFullYear()).toBe(ctx.clock.now().getUTCFullYear() + 5);
    const res = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/reports?kind=FINAL&format=pdf`)
      .set(bearer(await ctx.token(s.admin)))
      .buffer(true)
      .parse(binary as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('rapport-final');
    expect(
      createHash('sha256')
        .update(res.body as Buffer)
        .digest('hex'),
    ).toBe(stored.sha256);
    const json = await ctx.http
      .get(`/api/v1/tontines/${s.tontineId}/reports?kind=FINAL`)
      .set(bearer(await ctx.token(s.admin)));
    expect(json.body.data.summary['Total versé aux bénéficiaires']).toMatch(/87\D000/);
    expect(json.body.data.summary['Solde de la réserve (A-08)']).toMatch(/3\D000/);
  });
});

describe('US-10.4 — rapports financiers', () => {
  it('bilan par tour (JSON, CSV, PDF), mensuel, annuel, contributions, pénalités', async () => {
    const s = await startTontine(ctx, {}, ['=HYPERLINK("http://x")', 'Carl']);
    for (const u of s.users) await payCurrent(ctx, s, u);
    await settle(ctx);
    const token = await ctx.token(s.admin);
    const base = `/api/v1/tontines/${s.tontineId}/reports`;
    const cycle = await ctx.http.get(`${base}?kind=CYCLE&cycleNumber=1`).set(bearer(token));
    expect(cycle.status).toBe(200);
    expect(cycle.body.table.columns).toContain('Bénéficiaire');
    expect(cycle.body.table.rows[0][0]).toBe(1);
    expect((await ctx.http.get(`${base}?kind=CYCLE&cycleNumber=9`).set(bearer(token))).status).toBe(
      404,
    );
    const csv = await ctx.http.get(`${base}?kind=CONTRIBUTIONS&format=csv`).set(bearer(token));
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = csv.text;
    expect(text.split('\r\n')).toHaveLength(7); // en-tête + 3 contributions du tour 1 + 3 du tour 2 (ouvert après paiement)
    // protection contre l'injection de formules dans les tableurs
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).not.toMatch(/;=HYPERLINK/);
    const pdf = await ctx.http
      .get(`${base}?kind=CYCLE&format=pdf`)
      .set(bearer(token))
      .buffer(true)
      .parse(binary as never);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const monthly = await ctx.http
      .get(`${base}?kind=MONTHLY&year=2026&month=10`)
      .set(bearer(token));
    expect(monthly.body.table.rows[0]).toEqual([
      '2026-10',
      3,
      expect.stringMatching(/30\D000/),
      expect.any(String),
      1,
      expect.stringMatching(/29\D000/),
    ]);
    const annual = await ctx.http.get(`${base}?kind=ANNUAL&year=2026`).set(bearer(token));
    expect(annual.body.table.rows).toHaveLength(12);
    const penalties = await ctx.http.get(`${base}?kind=PENALTIES`).set(bearer(token));
    expect(penalties.body.table.rows).toHaveLength(0);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'report.generated' } }),
    ).toBeGreaterThanOrEqual(5);
  });

  it('isolation : un membre non admin (403) ou un tiers (404) n’accède pas aux rapports', async () => {
    const s = await startTontine(ctx);
    expect(
      (
        await ctx.http
          .get(`/api/v1/tontines/${s.tontineId}/reports?kind=CYCLE`)
          .set(bearer(await ctx.token(s.users[1]!)))
      ).status,
    ).toBe(403);
    const outsider = await ctx.createUser({ role: 'TONTINE_ADMIN' });
    expect(
      (
        await ctx.http
          .get(`/api/v1/tontines/${s.tontineId}/reports?kind=CYCLE`)
          .set(bearer(await ctx.token(outsider)))
      ).status,
    ).toBe(404);
    expect(
      (
        await ctx.http
          .get(`/api/v1/tontines/${s.tontineId}/reports?kind=UNKNOWN`)
          .set(bearer(await ctx.token(s.admin)))
      ).status,
    ).toBe(400);
  });
});

describe('US-6.6 / US-7.6 — réconciliations (super-admin)', () => {
  it('interne et PSP : écarts détectés, alerte, export CSV et PDF', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const token = await ctx.token(sa);
    const member = await ctx.createUser();
    const mt = await ctx.token(member);
    // dépôt réglé chez le PSP mais webhook perdu → statut divergent
    const dep = await ctx.http
      .post('/api/v1/me/wallet/deposits')
      .set(bearer(mt))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '5000', currency: 'XAF', method: 'MOBILE_MONEY', phone: '+237677001122' });
    await ctx.app
      .get(ProviderRegistry)
      .simulated(dep.body.provider)
      .settle(dep.body.providerReference, 'SUCCESS', false);
    // opération inconnue dans le relevé
    await ctx.prisma.pspSimOperation.create({
      data: {
        provider: 'simulated',
        reference: 'SIMMM-ORPHAN',
        kind: 'COLLECT_MOBILE_MONEY',
        status: 'SUCCESS',
        amountMinor: 700n,
        currency: 'XAF',
        merchantReference: randomUUID(),
        createdAt: ctx.clock.now(),
      },
    });
    ctx.clock.advanceDays(1);
    const psp = await ctx.http
      .post('/api/v1/admin/reconciliation/run')
      .set(bearer(await ctx.token(sa)))
      .send({ kind: 'PSP', date: '2026-09-24' });
    expect(psp.status).toBe(200);
    expect(psp.body).toMatchObject({ discrepancies: 2, alert: true });
    const detail = await ctx.http
      .get(`/api/v1/admin/reconciliation/${psp.body.reportId}`)
      .set(bearer(await ctx.token(sa)));
    expect(detail.body.discrepancies.map((d: { kind: string }) => d.kind).sort()).toEqual([
      'PSP_STATUS_MISMATCH',
      'PSP_UNKNOWN_OPERATION',
    ]);
    const csv = await ctx.http
      .get(`/api/v1/admin/reconciliation/${psp.body.reportId}?format=csv`)
      .set(bearer(await ctx.token(sa)));
    expect(csv.text).toContain('PSP_UNKNOWN_OPERATION');
    const pdf = await ctx.http
      .get(`/api/v1/admin/reconciliation/${psp.body.reportId}?format=pdf`)
      .set(bearer(await ctx.token(sa)))
      .buffer(true)
      .parse(binary as never);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const internal = await ctx.http
      .post('/api/v1/admin/reconciliation/run')
      .set(bearer(await ctx.token(sa)))
      .send({ kind: 'INTERNAL' });
    expect(internal.body.discrepancies).toBe(0);
    const list = await ctx.http
      .get('/api/v1/admin/reconciliation')
      .set(bearer(await ctx.token(sa)));
    expect(list.body.data).toHaveLength(2);
    await settle(ctx);
    expect(
      await ctx.prisma.notification.count({
        where: { recipientId: sa.id, templateKey: 'ops.alert' },
      }),
    ).toBeGreaterThanOrEqual(1);
    void token;
    expect(
      (await ctx.http.get('/api/v1/admin/reconciliation').set(bearer(await ctx.token(member))))
        .status,
    ).toBe(403);
  });
});

describe('A-14 — signalement de fraude', () => {
  it('suspension du membre et gel du portefeuille', async () => {
    const sa = await ctx.createUser({ role: 'SUPER_ADMIN' });
    const m = await ctx.createUser();
    const memberToken = await ctx.token(m);
    const res = await ctx.http
      .post('/api/v1/admin/fraud/flag')
      .set(bearer(await ctx.token(sa)))
      .send({ memberId: m.id, reason: 'Usurpation d’identité signalée' });
    expect(res.status).toBe(202);
    await settle(ctx);
    expect((await ctx.prisma.member.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      'SUSPENDED',
    );
    expect(
      (await ctx.prisma.wallet.findUniqueOrThrow({ where: { memberId: m.id } })).status,
    ).not.toBe('ACTIVE');
    // les sessions du membre suspendu sont révoquées
    expect((await ctx.http.get('/api/v1/me/wallet').set(bearer(memberToken))).status).toBe(401);
    // le compte suspendu ne peut plus se connecter
    await expect(ctx.token(m)).rejects.toThrow(/403/);
  });
});
