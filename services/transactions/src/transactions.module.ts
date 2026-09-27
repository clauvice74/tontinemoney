import { Module } from '@nestjs/common';
import { ComplianceModule } from '@tontine/compliance';
import { WalletsModule } from '@tontine/wallets';
import { FraudScoringPort, SimulatedFraudScoring } from './fraud-scoring';
import { InternalReconciliationService } from './reconciliation.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransfersService } from './transfers.service';
import { TransactionsConsumers } from './transactions.consumers';
import { PaymentSettlementSaga } from './sagas/payment-settlement.saga';
import { ContributionSaga } from './sagas/contribution.saga';
import { SagaOrchestrator } from './sagas/saga-orchestrator';
import { TontinePayoutSaga } from './sagas/tontine-payout.saga';

/** Domaine Transactions (épique 6). */
@Module({
  imports: [WalletsModule, ComplianceModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransfersService,
    InternalReconciliationService,
    SagaOrchestrator,
    PaymentSettlementSaga,
    ContributionSaga,
    TontinePayoutSaga,
    TransactionsConsumers,
    { provide: FraudScoringPort, useClass: SimulatedFraudScoring },
  ],
  exports: [TransactionsService, InternalReconciliationService, WalletsModule, ComplianceModule],
})
export class TransactionsModule {}
