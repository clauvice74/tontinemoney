import { Injectable } from '@nestjs/common';
import {
  type PlatformReport,
  type PlatformReportQuery,
  formatMoney,
  fromMinor,
} from '@tontine/contracts';
import { Prisma } from '@tontine/database';
import { AuditService, Clock, PrismaService } from '@tontine/platform';
import { type ReportDocument, type ReportTable, toCsv, toPdf } from './render';
import { type ReportOutput } from './reports.service';

/** Une ligne d'indicateur : format commun aux cinq rapports (JSON, CSV et PDF). */
export interface IndicatorRow {
  section: string;
  indicator: string;
  currency: string | null;
  count: number | null;
  amountMinor: string | null;
  /** Taux en pourcentage (ponctualité, etc.), sinon null. */
  ratePercent: number | null;
}

interface Period {
  from: string;
  to: string;
  start: Date;
  /** Borne exclusive : lendemain de `to` à 00:00 UTC. */
  end: Date;
}

type Params = Omit<PlatformReportQuery, 'format'>;

const TITLES: Record<PlatformReport, string> = {
  financial: 'Rapport financier de la plateforme',
  contributions: 'Rapport des contributions',
  wallets: 'Rapport des portefeuilles',
  compliance: 'Rapport de conformité',
  tontines: 'Rapport des tontines',
};

interface Agg {
  k: string;
  currency: string | null;
  n: bigint;
  total: bigint | null;
}

const row = (
  section: string,
  indicator: string,
  a: { currency?: string | null; n?: bigint | number | null; total?: bigint | null },
  ratePercent: number | null = null,
): IndicatorRow => ({
  section,
  indicator,
  currency: a.currency ?? null,
  count: a.n === undefined || a.n === null ? null : Number(a.n),
  amountMinor: a.total === undefined || a.total === null ? null : a.total.toString(),
  ratePercent,
});

/**
 * Rapports consolidés de la plateforme (super-admin) : agrégats uniquement, aucune donnée
 * personnelle. Requêtes SQL sur les seules projections du reporting (étape 6, A-54), alimentées
 * par les instantanés publiés par chaque domaine.
 */
@Injectable()
export class PlatformReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  period(p: Params): Period {
    const today = this.clock.today();
    const to = p.to ?? today;
    const from = p.from ?? `${to.slice(0, 7)}-01`;
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000);
    return { from, to, start, end };
  }

  async generate(
    report: PlatformReport,
    p: Params,
    format: 'json' | 'csv' | 'pdf',
  ): Promise<ReportOutput> {
    const period = this.period(p);
    const rows = await this.rows(report, period, p.currency ?? null);
    await this.audit.record({
      action: 'report.platform.generated',
      resourceType: 'report',
      resourceId: null,
      result: 'SUCCESS',
    });
    const base = `rapport-${report}-${period.from}_${period.to}`;
    if (format === 'json')
      return {
        kind: report,
        format,
        filename: `${base}.json`,
        contentType: 'application/json',
        body: {
          report,
          title: TITLES[report],
          period: { from: period.from, to: period.to },
          filters: { currency: p.currency ?? null },
          generatedAt: this.clock.now().toISOString(),
          rows: rows.map((r) => ({
            ...r,
            amount:
              r.amountMinor && r.currency ? fromMinor(BigInt(r.amountMinor), r.currency) : null,
          })),
        },
      };
    const table = this.table(rows);
    if (format === 'csv')
      return {
        kind: report,
        format,
        filename: `${base}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(toCsv(table), 'utf8'),
      };
    const doc: ReportDocument = {
      title: TITLES[report],
      subtitle: `Du ${period.from} au ${period.to}${p.currency ? ` — ${p.currency}` : ''}`,
      generatedAt: this.clock.now(),
      sections: [...new Set(rows.map((r) => r.section))].map((heading) => ({
        heading,
        table: this.table(
          rows.filter((r) => r.section === heading),
          false,
        ),
      })),
      footer: 'Agrégats uniquement — aucune donnée personnelle. Document confidentiel.',
    };
    return {
      kind: report,
      format,
      filename: `${base}.pdf`,
      contentType: 'application/pdf',
      body: await toPdf(doc),
    };
  }

  private table(rows: IndicatorRow[], withSection = true): ReportTable {
    const money = (r: IndicatorRow) =>
      r.amountMinor && r.currency ? formatMoney(BigInt(r.amountMinor), r.currency, 'fr-FR') : '';
    return {
      columns: [
        ...(withSection ? ['Section'] : []),
        'Indicateur',
        'Devise',
        'Nombre',
        'Montant',
        'Taux (%)',
      ],
      rows: rows.map((r) => [
        ...(withSection ? [r.section] : []),
        r.indicator,
        r.currency ?? '',
        r.count,
        money(r),
        r.ratePercent === null ? '' : r.ratePercent.toFixed(1),
      ]),
    };
  }

  rows(report: PlatformReport, p: Period, currency: string | null): Promise<IndicatorRow[]> {
    switch (report) {
      case 'financial':
        return this.financial(p, currency);
      case 'contributions':
        return this.contributions(p, currency);
      case 'wallets':
        return this.wallets(p, currency);
      case 'compliance':
        return this.compliance(p);
      case 'tontines':
        return this.tontines(p, currency);
    }
  }

  private cur(column: Prisma.Sql, currency: string | null): Prisma.Sql {
    return currency ? Prisma.sql`AND ${column} = ${currency}` : Prisma.empty;
  }

  private async financial(p: Period, currency: string | null): Promise<IndicatorRow[]> {
    const completed = await this.prisma.$queryRaw<Agg[]>`
      SELECT t."type"::text AS k, t."currency", count(*)::bigint AS n, sum(t."amountMinor")::bigint AS total
      FROM "rpt_transactions" t
      WHERE t."status" = 'COMPLETED' AND t."completedAt" >= ${p.start} AND t."completedAt" < ${p.end}
        ${this.cur(Prisma.sql`t."currency"`, currency)}
      GROUP BY 1, 2 ORDER BY 2, 1`;
    const failed = await this.prisma.$queryRaw<Agg[]>`
      SELECT t."status"::text || ' ' || t."type"::text AS k, t."currency", count(*)::bigint AS n,
             sum(t."amountMinor")::bigint AS total
      FROM "rpt_transactions" t
      WHERE t."status" IN ('FAILED', 'REJECTED') AND t."createdAt" >= ${p.start} AND t."createdAt" < ${p.end}
        ${this.cur(Prisma.sql`t."currency"`, currency)}
      GROUP BY 1, 2 ORDER BY 2, 1`;
    const payments = await this.prisma.$queryRaw<Array<Agg & { fees: bigint | null }>>`
      SELECT py."type"::text || ' ' || py."status"::text AS k, py."currency", count(*)::bigint AS n,
             sum(py."amountMinor")::bigint AS total, sum(py."feeMinor")::bigint AS fees
      FROM "rpt_payments" py
      WHERE py."createdAt" >= ${p.start} AND py."createdAt" < ${p.end}
        ${this.cur(Prisma.sql`py."currency"`, currency)}
      GROUP BY 1, 2 ORDER BY 2, 1`;

    const net = new Map<string, bigint>();
    for (const r of completed) {
      const sign = r.k === 'DEPOSIT' ? 1n : r.k === 'WITHDRAWAL' ? -1n : 0n;
      if (sign !== 0n && r.currency)
        net.set(r.currency, (net.get(r.currency) ?? 0n) + sign * (r.total ?? 0n));
    }
    return [
      ...completed.map((r) => row('Transactions réalisées', r.k, r)),
      ...[...net].map(([c, total]) =>
        row('Flux nets', 'Dépôts − retraits', { currency: c, total }),
      ),
      ...failed.map((r) => row('Transactions échouées ou rejetées', r.k, r)),
      ...payments.flatMap((r) => [
        row('Paiements PSP', r.k, r),
        ...(r.fees && r.fees > 0n
          ? [row('Frais PSP', r.k, { currency: r.currency, total: r.fees })]
          : []),
      ]),
    ];
  }

  private async contributions(p: Period, currency: string | null): Promise<IndicatorRow[]> {
    const byStatus = await this.prisma.$queryRaw<Agg[]>`
      SELECT c."status"::text AS k, t."currency", count(*)::bigint AS n, sum(c."amountMinor")::bigint AS total
      FROM "rpt_contributions" c JOIN "rpt_tontines" t ON t."id" = c."tontineId"
      WHERE c."dueDate" >= ${p.start} AND c."dueDate" < ${p.end}
        ${this.cur(Prisma.sql`t."currency"`, currency)}
      GROUP BY 1, 2 ORDER BY 2, 1`;
    const penalties = await this.prisma.$queryRaw<
      Array<{ currency: string; charged: bigint; chargedTotal: bigint; paidTotal: bigint }>
    >`
      SELECT t."currency", count(*)::bigint AS charged,
             sum(c."penaltyMinor")::bigint AS "chargedTotal",
             coalesce(sum(c."penaltyMinor") FILTER (WHERE c."penaltyPaid"), 0)::bigint AS "paidTotal"
      FROM "rpt_contributions" c JOIN "rpt_tontines" t ON t."id" = c."tontineId"
      WHERE c."penaltyMinor" > 0 AND c."dueDate" >= ${p.start} AND c."dueDate" < ${p.end}
        ${this.cur(Prisma.sql`t."currency"`, currency)}
      GROUP BY 1 ORDER BY 1`;

    // Ponctualité : payées à temps / contributions arrivées à échéance (hors PENDING)
    const perCurrency = new Map<string, { onTime: bigint; due: bigint }>();
    for (const r of byStatus) {
      if (!r.currency || r.k === 'PENDING') continue;
      const acc = perCurrency.get(r.currency) ?? { onTime: 0n, due: 0n };
      acc.due += r.n;
      if (r.k === 'PAID') acc.onTime += r.n;
      perCurrency.set(r.currency, acc);
    }
    return [
      ...byStatus.map((r) => row('Contributions par statut', r.k, r)),
      ...[...perCurrency].map(([c, a]) =>
        row(
          'Ponctualité',
          'Payées à l’échéance',
          { currency: c, n: a.onTime },
          a.due > 0n ? Math.round((Number(a.onTime) / Number(a.due)) * 1000) / 10 : null,
        ),
      ),
      ...penalties.flatMap((r) => [
        row('Pénalités', 'Appliquées', {
          currency: r.currency,
          n: r.charged,
          total: r.chargedTotal,
        }),
        row('Pénalités', 'Encaissées', { currency: r.currency, total: r.paidTotal }),
      ]),
    ];
  }

  private async wallets(p: Period, currency: string | null): Promise<IndicatorRow[]> {
    const snapshot = await this.prisma.$queryRaw<Array<Agg & { blocked: bigint | null }>>`
      SELECT w."ownerType"::text || ' ' || w."status"::text AS k, w."currency", count(*)::bigint AS n,
             sum(w."balanceMinor")::bigint AS total, sum(w."blockedMinor")::bigint AS blocked
      FROM "rpt_wallets" w
      WHERE TRUE ${this.cur(Prisma.sql`w."currency"`, currency)}
      GROUP BY 1, 2 ORDER BY 2, 1`;
    const movements = await this.prisma.$queryRaw<Agg[]>`
      SELECT m."type"::text AS k, w."currency", count(*)::bigint AS n, sum(m."amountMinor")::bigint AS total
      FROM "rpt_wallet_movements" m JOIN "rpt_wallets" w ON w."id" = m."walletId"
      WHERE m."createdAt" >= ${p.start} AND m."createdAt" < ${p.end}
        ${this.cur(Prisma.sql`w."currency"`, currency)}
      GROUP BY 1, 2 ORDER BY 2, 1`;
    return [
      ...snapshot.flatMap((r) => [
        row('Soldes (instantané)', r.k, r),
        ...(r.blocked && r.blocked > 0n
          ? [row('Montants bloqués (instantané)', r.k, { currency: r.currency, total: r.blocked })]
          : []),
      ]),
      ...movements.map((r) => row('Mouvements de la période', r.k, r)),
    ];
  }

  private async compliance(p: Period): Promise<IndicatorRow[]> {
    const count = (sql: Prisma.Sql) => this.prisma.$queryRaw<Array<{ k: string; n: bigint }>>(sql);
    const [members, kyc, kycRequests, aml, violations, opened, closed] = await Promise.all([
      count(
        Prisma.sql`SELECT "status"::text AS k, count(*)::bigint AS n FROM "rpt_members" GROUP BY 1 ORDER BY 1`,
      ),
      count(
        Prisma.sql`SELECT "kycLevel"::text AS k, count(*)::bigint AS n FROM "rpt_members" GROUP BY 1 ORDER BY 1`,
      ),
      count(Prisma.sql`SELECT "status"::text AS k, count(*)::bigint AS n FROM "rpt_kyc_requests"
        WHERE "submittedAt" >= ${p.start} AND "submittedAt" < ${p.end} GROUP BY 1 ORDER BY 1`),
      count(Prisma.sql`SELECT "listName" || ' ' || "status"::text AS k, count(*)::bigint AS n FROM "rpt_aml_matches"
        WHERE "createdAt" >= ${p.start} AND "createdAt" < ${p.end} GROUP BY 1 ORDER BY 1`),
      count(Prisma.sql`SELECT "ruleCode" || ' ' || "action"::text AS k, count(*)::bigint AS n FROM "rpt_violations"
        WHERE "createdAt" >= ${p.start} AND "createdAt" < ${p.end} GROUP BY 1 ORDER BY 1`),
      count(Prisma.sql`SELECT "type"::text AS k, count(*)::bigint AS n FROM "rpt_cases"
        WHERE "openedAt" >= ${p.start} AND "openedAt" < ${p.end} GROUP BY 1 ORDER BY 1`),
      count(Prisma.sql`SELECT "type"::text || ' ' || "outcome"::text AS k, count(*)::bigint AS n FROM "rpt_cases"
        WHERE "closedAt" >= ${p.start} AND "closedAt" < ${p.end} GROUP BY 1 ORDER BY 1`),
    ]);
    const section = (name: string, rows: Array<{ k: string; n: bigint }>) =>
      rows.map((r) => row(name, r.k, { n: r.n }));
    return [
      ...section('Membres par statut (instantané)', members),
      ...section('Membres par niveau KYC (instantané)', kyc),
      ...section('Demandes KYC soumises', kycRequests),
      ...section('Correspondances AML / PEP / sanctions', aml),
      ...section('Violations de règles', violations),
      ...section('Dossiers de conformité ouverts', opened),
      ...section('Dossiers de conformité clos', closed),
    ];
  }

  private async tontines(p: Period, currency: string | null): Promise<IndicatorRow[]> {
    const c = this.cur(Prisma.sql`t."currency"`, currency);
    const [byStatus, created, participants, cycles] = await Promise.all([
      this.prisma.$queryRaw<Agg[]>`
        SELECT t."status"::text AS k, t."currency", count(*)::bigint AS n, NULL::bigint AS total
        FROM "rpt_tontines" t WHERE TRUE ${c} GROUP BY 1, 2 ORDER BY 2, 1`,
      this.prisma.$queryRaw<Agg[]>`
        SELECT 'Créées' AS k, t."currency", count(*)::bigint AS n, NULL::bigint AS total
        FROM "rpt_tontines" t WHERE t."createdAt" >= ${p.start} AND t."createdAt" < ${p.end} ${c}
        GROUP BY 1, 2 ORDER BY 2`,
      this.prisma.$queryRaw<Agg[]>`
        SELECT 'Participants actifs' AS k, t."currency", count(*)::bigint AS n, NULL::bigint AS total
        FROM "rpt_tontine_members" tm JOIN "rpt_tontines" t ON t."id" = tm."tontineId"
        WHERE tm."status" = 'ACTIVE' AND t."status" IN ('ACTIVE', 'PAUSED') ${c}
        GROUP BY 1, 2 ORDER BY 2`,
      this.prisma.$queryRaw<Array<Agg & { payout: bigint | null }>>`
        SELECT 'Tours terminés' AS k, t."currency", count(*)::bigint AS n,
               sum(cy."collectedMinor")::bigint AS total, sum(cy."payoutMinor")::bigint AS payout
        FROM "rpt_cycles" cy JOIN "rpt_tontines" t ON t."id" = cy."tontineId"
        WHERE cy."status" = 'COMPLETED' AND cy."completedAt" >= ${p.start} AND cy."completedAt" < ${p.end} ${c}
        GROUP BY 1, 2 ORDER BY 2`,
    ]);
    return [
      ...byStatus.map((r) => row('Tontines par statut (instantané)', r.k, r)),
      ...created.map((r) => row('Activité de la période', r.k, r)),
      ...participants.map((r) => row('Participants (instantané)', r.k, r)),
      ...cycles.flatMap((r) => [
        row('Tours terminés', 'Collecté', r),
        row('Tours terminés', 'Versé aux bénéficiaires', { currency: r.currency, total: r.payout }),
      ]),
    ];
  }
}
