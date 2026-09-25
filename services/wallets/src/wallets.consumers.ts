import { Injectable } from '@nestjs/common';
import { getCountry } from '@tontine/contracts';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent, PrismaService } from '@tontine/platform';
import { WalletsService } from './wallets.service';

/** Consommateurs du domaine Wallet (US-5.1, fraude). */
@Injectable()
export class WalletsConsumers {
  constructor(
    private readonly wallets: WalletsService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('member.created', { consumer: 'wallets.creator' })
  async onMemberCreated(e: EventEnvelope<'member.created'>): Promise<void> {
    await this.wallets.createMemberWallet(e.payload.memberId, e.payload.currency);
  }

  /** Pays renseigné après coup : création différée du wallet. */
  @OnEvent('member.updated', { consumer: 'wallets.creator-on-country' })
  async onMemberUpdated(e: EventEnvelope<'member.updated'>): Promise<void> {
    if (!e.payload.changedFields.includes('country')) return;
    const country = e.payload.newValues['country'];
    if (typeof country !== 'string') return;
    await this.wallets.createMemberWallet(
      e.payload.memberId,
      getCountry(country)?.currency ?? null,
    );
  }

  /** Fraude détectée → wallet SUSPENDED (crédits seulement, R-WAL-03). */
  @OnEvent('fraud.user.flagged', { consumer: 'wallets.fraud' })
  async onFraud(e: EventEnvelope<'fraud.user.flagged'>): Promise<void> {
    const w = await this.prisma.wallet.findUnique({ where: { memberId: e.payload.memberId } });
    if (!w || w.status !== 'ACTIVE') return;
    await this.wallets.setStatus(
      w.id,
      'SUSPENDED',
      `Fraude : ${e.payload.reason}`,
      'fraud-service',
    );
  }
}
