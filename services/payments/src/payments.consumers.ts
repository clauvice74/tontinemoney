import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { type EventEnvelope } from '@tontine/events';
import { APP_CONFIG, Clock, OnEvent, PrismaService, ScheduledJob } from '@tontine/platform';
import { PaymentsService } from './payments.service';
import { ProviderRegistry } from './provider-registry';

/**
 * US-5.3 : le règlement interne (crédit du wallet ou capture du hold de retrait) est orchestré
 * par Transaction Service (saga PAYMENT_SETTLEMENT, A-53) ; Payment Service en reçoit l'issue.
 */
@Injectable()
export class PaymentsConsumers {
  private readonly logger = new Logger(PaymentsConsumers.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly registry: ProviderRegistry,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @OnEvent('transaction.saga.completed', { consumer: 'payments.settlement-result' })
  async onSettled(e: EventEnvelope<'transaction.saga.completed'>): Promise<void> {
    if (e.payload.sagaType !== 'PAYMENT_SETTLEMENT') return;
    await this.payments.recordSettlement(e.payload.reference, e.payload.transactionId);
  }

  @OnEvent('transaction.saga.failed', { consumer: 'payments.settlement-result' })
  async onSettlementFailed(e: EventEnvelope<'transaction.saga.failed'>): Promise<void> {
    if (e.payload.sagaType !== 'PAYMENT_SETTLEMENT') return;
    await this.payments.recordSettlementFailure(
      e.payload.reference,
      e.payload.failureCode,
      e.payload.failureReason,
    );
  }

  /**
   * Simulateur (hors production) : les versements Mobile Money en attente depuis plus de 30 s
   * sont réglés automatiquement et le webhook signé est émis — reproduit le délai opérateur.
   */
  @ScheduledJob({
    name: 'psp-sim.settle-payouts',
    cron: '*/30 * * * * *',
    description: 'Simulateur PSP : règlement automatique des retraits (hors production)',
  })
  async autoSettlePayouts(): Promise<{ settled: number }> {
    if (this.config.NODE_ENV === 'production') return { settled: 0 };
    const cutoff = new Date(this.clock.now().getTime() - 30_000);
    const ops = await this.prisma.pspSimOperation.findMany({
      where: { kind: 'PAYOUT', status: 'PENDING', createdAt: { lte: cutoff } },
      take: 50,
    });
    let settled = 0;
    for (const op of ops) {
      try {
        await this.registry.simulated(op.provider).settle(op.reference, 'SUCCESS');
        settled++;
      } catch (err) {
        this.logger.warn(
          `Simulateur : règlement ${op.reference} impossible (${(err as Error).message})`,
        );
      }
    }
    return { settled };
  }
}
