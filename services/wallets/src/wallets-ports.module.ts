import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService, WALLET_QUERY, type WalletQueryPort } from '@tontine/platform';

/** Lecture exacte du wallet d'un membre pour les autres domaines (A-54). */
@Injectable()
export class WalletQueryService implements WalletQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async memberBalance(memberId: string): Promise<bigint | null> {
    const w = await this.prisma.wallet.findUnique({
      where: { memberId },
      select: { balanceMinor: true },
    });
    return w?.balanceMinor ?? null;
  }
}

/** Port global WALLET_QUERY, fourni par wallet-service. */
@Global()
@Module({
  providers: [WalletQueryService, { provide: WALLET_QUERY, useExisting: WalletQueryService }],
  exports: [WALLET_QUERY],
})
export class WalletsPortsModule {}
