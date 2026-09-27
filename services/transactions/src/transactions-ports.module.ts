import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@tontine/database';
import { PrismaService, TRANSACTION_TOTALS, type TransactionTotalsPort } from '@tontine/platform';

/** Cumuls d'opérations d'un membre, calculés sur les transactions du domaine (A-54). */
@Injectable()
export class TransactionTotalsService implements TransactionTotalsPort {
  constructor(private readonly prisma: PrismaService) {}

  async initiatedTotal(
    memberId: string,
    currency: string,
    types: readonly string[],
    since: Date,
  ): Promise<bigint> {
    if (types.length === 0) return 0n;
    const res = await this.prisma.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT coalesce(sum("amountMinor"), 0)::bigint AS total FROM "trx_transactions"
      WHERE "initiatorId" = ${memberId}::uuid AND "currency" = ${currency}
        AND "status" IN ('VALIDATED', 'COMPLETED')
        AND "type"::text IN (${Prisma.join([...types])})
        AND "createdAt" >= ${since}`;
    return res[0]?.total ?? 0n;
  }
}

/** Port global TRANSACTION_TOTALS, fourni par transaction-service. */
@Global()
@Module({
  providers: [
    TransactionTotalsService,
    { provide: TRANSACTION_TOTALS, useExisting: TransactionTotalsService },
  ],
  exports: [TRANSACTION_TOTALS],
})
export class TransactionsPortsModule {}
