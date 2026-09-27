import { randomUUID } from 'node:crypto';
import { OutboxService, UnitOfWork } from '@tontine/platform';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, bearer, createTestContext } from './support/test-app';
import { runToCompletion, settle, startTontine } from './support/tontine';

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

interface Row {
  section: string;
  indicator: string;
  currency: string | null;
  count: number | null;
  amountMinor: string | null;
  amount: string | null;
  ratePercent: number | null;
}

function binary(
  res: NodeJS.ReadableStream & { on(ev: string, cb: (c?: unknown) => void): void },
  cb: (err: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(Buffer.from(c as Buffer)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function adminToken() {
  return ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN', country: 'SN' }));
}

const find = (rows: Row[], section: string, indicator: string, currency?: string) =>
  rows.find(
    (r) =>
      r.section === section && r.indicator === indicator && (!currency || r.currency === currency),
  );

describe('GET /reports/financial', () => {
  it('agrège les dépôts réalisés par devise, flux nets ; filtre devise ; aucune donnée personnelle', async () => {
    const token = await adminToken();
    const a = await ctx.createUser({ firstName: 'Zebulon', lastName: 'Unique' });
    const b = await ctx.createUser();
    await ctx.fund(a.id, 50_000n);
    await ctx.fund(b.id, 20_000n);

    const res = await ctx.http
      .get('/api/v1/reports/financial?from=2026-09-01&to=2026-09-30')
      .set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      report: 'financial',
      period: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(find(res.body.rows, 'Transactions réalisées', 'DEPOSIT', 'XAF')).toMatchObject({
      count: 2,
      amountMinor: '70000',
      amount: '70000',
    });
    expect(find(res.body.rows, 'Flux nets', 'Dépôts − retraits', 'XAF')?.amountMinor).toBe('70000');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('Zebulon');
    expect(raw).not.toContain(a.email);

    const ngn = await ctx.http
      .get('/api/v1/reports/financial?from=2026-09-01&to=2026-09-30&currency=ngn')
      .set(bearer(token));
    expect(ngn.body.filters.currency).toBe('NGN');
    expect(ngn.body.rows.some((r: Row) => r.currency === 'XAF')).toBe(false);

    const before = await ctx.http
      .get('/api/v1/reports/financial?from=2026-08-01&to=2026-08-31')
      .set(bearer(token));
    expect(find(before.body.rows, 'Transactions réalisées', 'DEPOSIT')).toBeUndefined();
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'report.platform.generated' } }),
    ).toBe(3);
  });

  it('période par défaut : du 1er du mois courant à aujourd’hui', async () => {
    const res = await ctx.http.get('/api/v1/reports/financial').set(bearer(await adminToken()));
    expect(res.body.period).toEqual({ from: '2026-09-01', to: '2026-09-24' });
  });
});

describe('GET /reports/contributions, /tontines, /wallets', () => {
  it('une tontine menée à terme : contributions payées, ponctualité, tours terminés', async () => {
    const s = await startTontine(ctx);
    await runToCompletion(ctx, s);
    await settle(ctx);
    const token = await adminToken();
    const q = '?from=2026-09-01&to=2027-09-01';

    const contrib = await ctx.http.get(`/api/v1/reports/contributions${q}`).set(bearer(token));
    const expected = await ctx.prisma.contribution.count({ where: { tontineId: s.tontineId } });
    const paid = contrib.body.rows.filter((r: Row) => r.section === 'Contributions par statut');
    expect(paid.reduce((n: number, r: Row) => n + (r.count ?? 0), 0)).toBe(expected);
    expect(find(contrib.body.rows, 'Ponctualité', 'Payées à l’échéance')?.ratePercent).toBe(100);

    const tontines = await ctx.http.get(`/api/v1/reports/tontines${q}`).set(bearer(token));
    expect(find(tontines.body.rows, 'Tontines par statut (instantané)', 'COMPLETED')?.count).toBe(
      1,
    );
    expect(find(tontines.body.rows, 'Tours terminés', 'Collecté')?.count).toBe(s.users.length);

    const wallets = await ctx.http.get(`/api/v1/reports/wallets${q}`).set(bearer(token));
    const member = find(wallets.body.rows, 'Soldes (instantané)', 'MEMBER ACTIVE', 'XAF');
    const sum = await ctx.prisma.wallet.aggregate({
      where: { ownerType: 'MEMBER', status: 'ACTIVE', currency: 'XAF' },
      _sum: { balanceMinor: true },
      _count: true,
    });
    expect(member).toMatchObject({
      count: sum._count,
      amountMinor: String(sum._sum.balanceMinor ?? 0n),
    });
    expect(wallets.body.rows.some((r: Row) => r.section === 'Mouvements de la période')).toBe(true);
  });
});

describe('GET /reports/compliance', () => {
  it('membres par statut et dossiers de conformité ouverts sur la période', async () => {
    const token = await adminToken();
    const m = await ctx.createUser();
    await ctx.app.get(UnitOfWork).run((tx) =>
      ctx.app.get(OutboxService).add(tx, {
        type: 'compliance.violation.detected',
        aggregateType: 'member',
        aggregateId: m.id,
        payload: {
          violationId: randomUUID(),
          memberId: m.id,
          operationType: 'DEPOSIT',
          ruleCode: 'CM-DAILY-LIMIT',
          action: 'BLOCK',
        },
      }),
    );
    await ctx.drain();
    const res = await ctx.http.get('/api/v1/reports/compliance').set(bearer(token));
    expect(find(res.body.rows, 'Membres par statut (instantané)', 'ACTIVE')?.count).toBe(
      await ctx.prisma.member.count({ where: { status: 'ACTIVE' } }),
    );
    expect(find(res.body.rows, 'Dossiers de conformité ouverts', 'RULE_VIOLATION')?.count).toBe(1);
  });
});

describe('Formats et export', () => {
  it('CSV : BOM, séparateur « ; », colonnes communes ; PDF valide', async () => {
    const token = await adminToken();
    await ctx.fund((await ctx.createUser()).id, 1_000n);
    const csv = await ctx.http.get('/api/v1/reports/financial?format=csv').set(bearer(token));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain(
      'rapport-financial-2026-09-01_2026-09-24.csv',
    );
    const [header, ...lines] = csv.text.split('\r\n');
    expect(header).toBe('﻿Section;Indicateur;Devise;Nombre;Montant;Taux (%)');
    expect(lines.some((l) => l.startsWith('Transactions réalisées;DEPOSIT;XAF;1;'))).toBe(true);

    const pdf = await ctx.http
      .get('/api/v1/reports/export?report=tontines&format=pdf')
      .set(bearer(token))
      .buffer(true)
      .parse(binary as never);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('export : CSV par défaut ; rapport et format validés', async () => {
    const token = await adminToken();
    const res = await ctx.http.get('/api/v1/reports/export?report=wallets').set(bearer(token));
    expect(res.headers['content-type']).toContain('text/csv');
    for (const q of ['report=wallets&format=json', 'report=nope', 'format=csv']) {
      expect((await ctx.http.get(`/api/v1/reports/export?${q}`).set(bearer(token))).status).toBe(
        400,
      );
    }
  });
});

describe('Validation et accès', () => {
  it('période inversée, > 366 jours, devise invalide, paramètre inconnu → 400', async () => {
    const token = await adminToken();
    for (const q of [
      'from=2026-09-10&to=2026-09-01',
      'from=2025-01-01&to=2026-09-01',
      'currency=EURO',
      'tontineId=x',
    ]) {
      const res = await ctx.http.get(`/api/v1/reports/financial?${q}`).set(bearer(token));
      expect(res.status, q).toBe(400);
    }
  });

  it('réservé au super-admin : agent KYC, admin de tontine et membre → 403 ; sans jeton → 401', async () => {
    for (const role of ['KYC_AGENT', 'TONTINE_ADMIN', 'MEMBER'] as const) {
      const u = await ctx.createUser({ role });
      const res = await ctx.http.get('/api/v1/reports/wallets').set(bearer(await ctx.token(u)));
      expect(res.status, role).toBe(403);
    }
    expect((await ctx.http.get('/api/v1/reports/export?report=wallets')).status).toBe(401);
  });
});
