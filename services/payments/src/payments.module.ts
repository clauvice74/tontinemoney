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
import { PspReconciliationService } from './psp-reconciliation.service';

/** Domaine Paiements (épique 7) — prestataires simulés uniquement. */
@Module({
  imports: [TransactionsModule],
  controllers: [PaymentsController, WebhooksController, PspSimulatorController],
  providers: [ProviderRegistry, PaymentsService, PaymentsConsumers, PspReconciliationService],
  exports: [PaymentsService, ProviderRegistry, PspReconciliationService],
})
export class PaymentsModule {}
