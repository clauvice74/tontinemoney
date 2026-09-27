import { type PaymentNotification } from '@tontine/contracts';
import {
  type PaymentGatewayReceipt,
  type PrismaClient,
  isUniqueViolation,
} from '@tontine/database';

export type Claim =
  /** Premier passage : à transmettre. */
  | { kind: 'new'; receipt: PaymentGatewayReceipt }
  /** Échec précédent ou bail expiré, repris atomiquement par cette requête : à retransmettre. */
  | { kind: 'retry'; receipt: PaymentGatewayReceipt }
  /** Transmission en cours par une autre requête (bail actif) : le PSP réessaiera. */
  | { kind: 'in_progress'; receipt: PaymentGatewayReceipt }
  /** Déjà transmis : rejeu ignoré (idempotence). */
  | { kind: 'duplicate'; receipt: PaymentGatewayReceipt }
  /** Même identifiant d'événement, contenu différent : refus (falsification ou erreur PSP). */
  | { kind: 'conflict'; receipt: PaymentGatewayReceipt };

/** Journal des webhooks acceptés (table `pgw_webhook_receipts`, propriété du Payment Gateway). */
export class ReceiptStore {
  /** `leaseMs` : durée maximale d'une transmission (délai × tentatives, avec marge). */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly leaseMs: number,
  ) {}

  async claim(n: PaymentNotification, bodySha256: string, now: Date): Promise<Claim> {
    try {
      const receipt = await this.prisma.paymentGatewayReceipt.create({
        data: {
          provider: n.provider,
          providerEventId: n.providerEventId,
          bodySha256,
          merchantReference: n.merchantReference,
          status: n.status,
          amountMinor: BigInt(n.amountMinor),
          currency: n.currency,
          receivedAt: now,
          claimedAt: now,
        },
      });
      return { kind: 'new', receipt };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    const receipt = await this.prisma.paymentGatewayReceipt.findUniqueOrThrow({
      where: {
        provider_providerEventId: { provider: n.provider, providerEventId: n.providerEventId },
      },
    });
    if (receipt.bodySha256 !== bodySha256) return { kind: 'conflict', receipt };
    if (receipt.state === 'FORWARDED') return { kind: 'duplicate', receipt };
    // Reprise atomique : une seule requête obtient le bail (échec précédent ou bail expiré)
    const taken = await this.prisma.paymentGatewayReceipt.updateMany({
      where: {
        id: receipt.id,
        OR: [
          { state: 'FORWARD_FAILED' },
          { state: 'RECEIVED', claimedAt: { lt: new Date(now.getTime() - this.leaseMs) } },
        ],
      },
      data: { state: 'RECEIVED', claimedAt: now },
    });
    return taken.count === 1 ? { kind: 'retry', receipt } : { kind: 'in_progress', receipt };
  }

  async forwarded(id: string, outcome: string, attempts: number, now: Date): Promise<void> {
    await this.prisma.paymentGatewayReceipt.update({
      where: { id },
      data: {
        state: 'FORWARDED',
        outcome,
        attempts: { increment: attempts },
        forwardedAt: now,
        lastError: null,
      },
    });
  }

  async failed(id: string, error: string, attempts: number): Promise<void> {
    await this.prisma.paymentGatewayReceipt.update({
      where: { id },
      data: {
        state: 'FORWARD_FAILED',
        attempts: { increment: attempts },
        lastError: error.slice(0, 500),
      },
    });
  }
}
