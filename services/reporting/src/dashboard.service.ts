import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNT_DIRECTORY,
  type AccountDirectoryPort,
  Clock,
  PrismaService,
} from '@tontine/platform';

/**
 * Tableau de bord du super-admin : files de travail et signaux d'exploitation. Comptes via le
 * port d'Auth ; agrégats métier sur les projections du reporting (étape 6, A-54).
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(ACCOUNT_DIRECTORY) private readonly accounts: AccountDirectoryPort,
  ) {}

  async overview() {
    const now = this.clock.now();
    const startOfDay = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const count = <T extends { k: string; n: bigint }>(rows: T[]) =>
      Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
    const [accounts, kyc, cases, unassigned, payments, today, deadEvents, failedJobs, lastRecon] =
      await Promise.all([
        this.accounts.statistics(),
        this.prisma.$queryRaw<Array<{ k: string; n: bigint }>>`
          SELECT "status"::text AS k, count(*)::bigint AS n FROM "rpt_kyc_requests"
          WHERE "status" IN ('REVIEW_REQUIRED', 'SUPPLEMENT_REQUESTED', 'PROCESSING') GROUP BY 1`,
        this.prisma.$queryRaw<Array<{ k: string; n: bigint }>>`
          SELECT "severity"::text AS k, count(*)::bigint AS n FROM "rpt_cases"
          WHERE "status" = 'OPEN' GROUP BY 1`,
        this.prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM "rpt_cases" WHERE "status" = 'OPEN' AND "assigneeId" IS NULL`,
        this.prisma.$queryRaw<Array<{ k: string; n: bigint }>>`
          SELECT "status"::text AS k, count(*)::bigint AS n FROM "rpt_payments"
          WHERE "status" IN ('PENDING', 'PROCESSING') GROUP BY 1`,
        this.prisma.$queryRaw<Array<{ currency: string; n: bigint; total: bigint }>>`
          SELECT "currency", count(*)::bigint AS n, sum("amountMinor")::bigint AS total
          FROM "rpt_transactions" WHERE "status" = 'COMPLETED' AND "completedAt" >= ${startOfDay}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
        this.prisma.jobRun.count({
          where: { status: 'FAILED', startedAt: { gte: new Date(now.getTime() - 86_400_000) } },
        }),
        this.prisma.rptReconciliation.findFirst({ orderBy: { createdAt: 'desc' } }),
      ]);
    return {
      generatedAt: now.toISOString(),
      accounts,
      kyc: { byStatus: count(kyc) },
      compliance: {
        openCasesBySeverity: count(cases),
        unassignedOpenCases: Number(unassigned[0]?.n ?? 0),
      },
      payments: { inFlight: count(payments) },
      transactionsToday: today.map((r) => ({
        currency: r.currency,
        count: Number(r.n),
        amountMinor: r.total.toString(),
      })),
      operations: {
        deadEvents,
        failedJobs24h: failedJobs,
        lastReconciliation: lastRecon
          ? {
              kind: lastRecon.kind,
              businessDate: lastRecon.businessDate.toISOString().slice(0, 10),
              status: lastRecon.status,
              discrepancyCount: lastRecon.discrepancyCount,
              alert: lastRecon.alert,
            }
          : null,
      },
    };
  }
}
