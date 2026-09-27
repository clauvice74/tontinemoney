import { Injectable, Logger } from '@nestjs/common';
import { Clock, PrismaService, ScheduledJob } from '@tontine/platform';
import { type Discrepancy, InternalReconciliationService } from '@tontine/transactions';
import { ProviderRegistry } from './provider-registry';

/**
 * US-7.6 — réconciliation PSP quotidienne : relevé du prestataire (API) ⇄ paiements internes.
 * Écarts : opération PSP inconnue, paiement absent du relevé, statut ou montant divergent.
 */
@Injectable()
export class PspReconciliationService {
  private readonly logger = new Logger(PspReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly registry: ProviderRegistry,
    private readonly internal: InternalReconciliationService,
  ) {}

  async compute(day: string): Promise<{ checked: number; discrepancies: Discrepancy[] }> {
    const discrepancies: Discrepancy[] = [];
    let checked = 0;
    const from = new Date(`${day}T00:00:00Z`);
    const to = new Date(from.getTime() + 86_400_000);
    for (const provider of this.registry.allSimulated()) {
      const { result: lines } = await this.registry.call(provider, (p) => p.statement(day));
      const payments = await this.prisma.payment.findMany({
        where: { provider: provider.name, createdAt: { gte: from, lt: to } },
      });
      const byRef = new Map(
        payments.filter((p) => p.providerReference).map((p) => [p.providerReference!, p]),
      );
      const byId = new Map(payments.map((p) => [p.id, p]));
      const seen = new Set<string>();
      for (const l of lines) {
        checked++;
        const p = byRef.get(l.providerReference) ?? byId.get(l.merchantReference);
        if (!p) {
          discrepancies.push({
            kind: 'PSP_UNKNOWN_OPERATION',
            reference: l.providerReference,
            expected: '0',
            actual: l.amountMinor.toString(),
            deltaMinor: l.amountMinor.toString(),
            detail: `Opération ${l.kind} du relevé ${provider.name} sans paiement interne`,
          });
          continue;
        }
        seen.add(p.id);
        if (l.amountMinor !== p.amountMinor || l.currency !== p.currency) {
          discrepancies.push({
            kind: 'PSP_AMOUNT_MISMATCH',
            reference: p.id,
            expected: `${p.amountMinor} ${p.currency}`,
            actual: `${l.amountMinor} ${l.currency}`,
            deltaMinor: (l.amountMinor - p.amountMinor).toString(),
            detail: 'Montant ou devise du relevé ≠ paiement interne',
          });
        }
        const internalOk = p.status === 'COMPLETED' || p.status === 'REFUNDED';
        if (l.status === 'SUCCESS' && !internalOk) {
          discrepancies.push({
            kind: 'PSP_STATUS_MISMATCH',
            reference: p.id,
            expected: 'COMPLETED',
            actual: p.status,
            deltaMinor: p.amountMinor.toString(),
            detail: 'Réglé chez le PSP mais non complété en interne',
          });
        } else if (l.status === 'FAILED' && internalOk) {
          discrepancies.push({
            kind: 'PSP_STATUS_MISMATCH',
            reference: p.id,
            expected: 'FAILED',
            actual: p.status,
            deltaMinor: (-p.amountMinor).toString(),
            detail: 'Refusé chez le PSP mais complété en interne',
          });
        }
      }
      for (const p of payments) {
        if (seen.has(p.id) || !p.providerReference) continue;
        checked++;
        discrepancies.push({
          kind: 'PSP_MISSING_OPERATION',
          reference: p.id,
          expected: p.amountMinor.toString(),
          actual: '0',
          deltaMinor: p.amountMinor.toString(),
          detail: `Paiement ${p.status} absent du relevé ${provider.name}`,
        });
      }
    }
    return { checked, discrepancies };
  }

  /** Relevé de la veille (UTC) ; `day` explicite pour un rattrapage. */
  async run(day?: string) {
    const target =
      day ?? new Date(this.clock.now().getTime() - 86_400_000).toISOString().slice(0, 10);
    const { checked, discrepancies } = await this.compute(target);
    if (discrepancies.length)
      this.logger.warn(`Réconciliation PSP ${target} : ${discrepancies.length} écart(s)`);
    return this.internal.record('PSP', target, checked, discrepancies);
  }

  @ScheduledJob({
    name: 'payments.reconcile-psp',
    cron: '0 0 2 * * *',
    description: 'Réconciliation PSP quotidienne (relevés ⇄ paiements, US-7.6)',
  })
  async job() {
    return this.run();
  }
}
