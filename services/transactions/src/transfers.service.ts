import { Inject, Injectable } from '@nestjs/common';
import { type TransferInput, toMinor } from '@tontine/contracts';
import { type Actor, DomainError, MEMBER_QUERY, type MemberQueryPort, PrismaService } from '@tontine/platform';
import { TransactionsService } from './transactions.service';

/** US-5.6 — transfert atomique entre membres (débit A + crédit B, même devise, idempotent). */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  async transfer(actor: Actor, input: TransferInput, idempotencyKey: string) {
    const recipient = input.toMemberId
      ? await this.members.snapshot(input.toMemberId)
      : await this.members.findByIdentifier(input.toIdentifier ?? '');
    if (!recipient) throw new DomainError('NOT_FOUND', 'Destinataire introuvable');
    if (recipient.id === actor.userId) throw new DomainError('BUSINESS_RULE_VIOLATION', 'Transfert vers soi-même impossible');
    const [from, to] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { memberId: actor.userId } }),
      this.prisma.wallet.findUnique({ where: { memberId: recipient.id } }),
    ]);
    if (!from || !to) throw new DomainError('NOT_FOUND', 'Portefeuille introuvable');
    // A-11 : pas de conversion de devise en V1
    if (from.currency !== input.currency || to.currency !== input.currency) {
      throw new DomainError('CURRENCY_MISMATCH', 'Les deux portefeuilles doivent être dans la devise du transfert');
    }
    if (to.status !== 'ACTIVE') throw new DomainError('WALLET_NOT_OPERATIONAL', 'Le portefeuille du destinataire n’est pas actif');
    const amountMinor = toMinor(input.amount, input.currency);
    return this.transactions.execute({
      idempotencyKey: `transfer:${actor.userId}:${idempotencyKey}`,
      type: 'TRANSFER',
      amountMinor,
      currency: input.currency,
      initiatorId: actor.userId,
      beneficiaryId: recipient.id,
      sourceWalletId: from.id,
      destinationWalletId: to.id,
      contextType: 'WALLET',
      contextId: to.id,
      description: input.note ?? 'Transfert entre membres',
      lines: [
        { walletId: from.id, direction: 'DEBIT', amountMinor, context: 'TRANSFER', description: `Transfert vers ${recipient.firstName}` },
        { walletId: to.id, direction: 'CREDIT', amountMinor, context: 'TRANSFER', description: 'Transfert reçu' },
      ],
      eligibility: { memberId: actor.userId, minKyc: 'TIER_2' },
      compliance: { operationType: 'TRANSFER', memberId: actor.userId, creditMemberId: recipient.id },
      fraudCheck: true,
    });
  }
}
