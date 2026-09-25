import { Injectable } from '@nestjs/common';
import { Clock, OutboxService, PrismaService, ScheduledJob, UnitOfWork } from '@tontine/platform';

export interface Discrepancy {
  kind: string;
  reference: string;
  expected: string;
  actual: string;
  deltaMinor: string;
  detail: string;
}

/** Seuil d'alerte (écart cumulé en unités mineures) au-delà duquel une alerte est levée (US-6.6). */
export const RECONCILIATION_ALERT_THRESHOLD_MINOR = 0n;

/**
 * US-6.6 — réconciliation interne quotidienne : transactions internes ⇄ paiements PSP ⇄ mouvements
 * wallet (partie double, soldes projetés, blocages). Lecture seule sur les tables des domaines concernés.
 */
@Injectable()
export class InternalReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  async compute(): Promise<{ checked: number; discrepancies: Discrepancy[] }> {
    const discrepancies: Discrepancy[] = [];
    // 1. Partie double : Σ débits = Σ crédits pour chaque transaction COMPLETED/REVERSED
    const unbalanced = await this.prisma.$queryRaw<Array<{ id: string; debit: bigint; credit: bigint }>>`
      SELECT t."id",
             coalesce(sum(m."amountMinor") FILTER (WHERE m."type" = 'DEBIT'), 0)::bigint AS debit,
             coalesce(sum(m."amountMinor") FILTER (WHERE m."type" = 'CREDIT'), 0)::bigint AS credit
      FROM "trx_transactions" t LEFT JOIN "wal_movements" m ON m."transactionId" = t."id"
      WHERE t."status" IN ('COMPLETED', 'REVERSED')
      GROUP BY t."id"
      HAVING coalesce(sum(m."amountMinor") FILTER (WHERE m."type" = 'DEBIT'), 0) <> coalesce(sum(m."amountMinor") FILTER (WHERE m."type" = 'CREDIT'), 0)
          OR coalesce(sum(m."amountMinor") FILTER (WHERE m."type" = 'DEBIT'), 0) = 0`;
    for (const u of unbalanced) {
      discrepancies.push({ kind: 'UNBALANCED_TRANSACTION', reference: u.id, expected: u.debit.toString(), actual: u.credit.toString(), deltaMinor: (u.debit - u.credit).toString(), detail: 'Σ débits ≠ Σ crédits' });
    }
    // 2. Soldes projetés = Σ crédits − Σ débits ; bloqué = Σ holds actifs
    const wallets = await this.prisma.$queryRaw<Array<{ id: string; balance: bigint; ledger: bigint; blocked: bigint; holds: bigint }>>`
      SELECT w."id", w."balanceMinor" AS balance, w."blockedMinor" AS blocked,
             coalesce((SELECT sum(CASE m."type" WHEN 'CREDIT' THEN m."amountMinor" WHEN 'DEBIT' THEN -m."amountMinor" ELSE 0 END)
                       FROM "wal_movements" m WHERE m."walletId" = w."id"), 0)::bigint AS ledger,
             coalesce((SELECT sum(h."amountMinor") FROM "wal_holds" h WHERE h."walletId" = w."id" AND h."status" = 'ACTIVE'), 0)::bigint AS holds
      FROM "wal_wallets" w`;
    for (const w of wallets) {
      if (w.balance !== w.ledger) {
        discrepancies.push({ kind: 'WALLET_BALANCE_MISMATCH', reference: w.id, expected: w.ledger.toString(), actual: w.balance.toString(), deltaMinor: (w.balance - w.ledger).toString(), detail: 'Solde ≠ somme des mouvements' });
      }
      if (w.blocked !== w.holds) {
        discrepancies.push({ kind: 'WALLET_HOLD_MISMATCH', reference: w.id, expected: w.holds.toString(), actual: w.blocked.toString(), deltaMinor: (w.blocked - w.holds).toString(), detail: 'Montant bloqué ≠ holds actifs' });
      }
    }
    // 3. Paiements PSP ⇄ transactions internes
    const payments = await this.prisma.$queryRaw<Array<{ id: string; amount: bigint; txId: string | null; txStatus: string | null; txAmount: bigint | null }>>`
      SELECT p."id", p."amountMinor" AS amount, p."transactionId" AS "txId", t."status"::text AS "txStatus", t."amountMinor" AS "txAmount"
      FROM "pay_payments" p LEFT JOIN "trx_transactions" t ON t."id" = p."transactionId"
      WHERE p."status" IN ('COMPLETED', 'REFUNDED')`;
    for (const p of payments) {
      if (!p.txId || !p.txStatus || !['COMPLETED', 'REVERSED'].includes(p.txStatus)) {
        discrepancies.push({ kind: 'PAYMENT_WITHOUT_TRANSACTION', reference: p.id, expected: p.amount.toString(), actual: '0', deltaMinor: p.amount.toString(), detail: 'Paiement PSP confirmé sans transaction interne complétée' });
      } else if (p.txAmount !== p.amount) {
        discrepancies.push({ kind: 'PAYMENT_AMOUNT_MISMATCH', reference: p.id, expected: p.amount.toString(), actual: String(p.txAmount), deltaMinor: (p.amount - (p.txAmount ?? 0n)).toString(), detail: 'Montant PSP ≠ montant interne' });
      }
    }
    return { checked: unbalanced.length + wallets.length + payments.length, discrepancies };
  }

  @ScheduledJob({ name: 'transactions.reconcile', cron: '0 30 1 * * *', description: 'Réconciliation interne quotidienne (US-6.6)' })
  async run(): Promise<{ reportId: string; discrepancies: number }> {
    const { checked, discrepancies } = await this.compute();
    const total = discrepancies.reduce((s, d) => s + (BigInt(d.deltaMinor) < 0n ? -BigInt(d.deltaMinor) : BigInt(d.deltaMinor)), 0n);
    const alert = discrepancies.length > 0 && total >= RECONCILIATION_ALERT_THRESHOLD_MINOR;
    const report = await this.uow.run(async (tx) => {
      const r = await tx.reconciliationReport.create({
        data: {
          kind: 'INTERNAL',
          businessDate: new Date(`${this.clock.today()}T00:00:00Z`),
          status: discrepancies.length ? 'DISCREPANCIES' : 'BALANCED',
          checkedCount: checked,
          discrepancyCount: discrepancies.length,
          thresholdMinor: RECONCILIATION_ALERT_THRESHOLD_MINOR,
          alert,
          details: discrepancies as unknown as object,
          createdAt: this.clock.now(),
        },
      });
      await this.outbox.add(tx, {
        type: 'reconciliation.completed',
        aggregateType: 'reconciliation',
        aggregateId: r.id,
        payload: { reportId: r.id, kind: 'INTERNAL', discrepancies: discrepancies.length, alert },
      });
      return r;
    });
    return { reportId: report.id, discrepancies: discrepancies.length };
  }
}

export function reconciliationCsv(rows: Discrepancy[]): string {
  const esc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = 'kind;reference;expected;actual;deltaMinor;detail';
  return [header, ...rows.map((r) => [r.kind, r.reference, r.expected, r.actual, r.deltaMinor, r.detail].map(esc).join(';'))].join('\n');
}
