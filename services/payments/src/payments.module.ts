import { Module } from '@nestjs/common';
import { TransactionsModule } from '@tontine/transactions';
import { PaymentsConsumers } from './payments.consumers';
import {
  PaymentsController,
  PspSimulatorController,
  WebhooksController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProviderRegistry } from './provider-registry';

/** Domaine Paiements (épique 7) — prestataires simulés uniquement. */
@Module({
  imports: [TransactionsModule],
  controllers: [PaymentsController, WebhooksController, PspSimulatorController],
  providers: [ProviderRegistry, PaymentsService, PaymentsConsumers],
  exports: [PaymentsService, ProviderRegistry],
})
export class PaymentsModule {}
