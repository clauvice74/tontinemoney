import { Module } from '@nestjs/common';
import { ComplianceModule } from '@tontine/compliance';
import { WalletsModule } from '@tontine/wallets';
import { FraudScoringPort, SimulatedFraudScoring } from './fraud-scoring';
import { InternalReconciliationService } from './reconciliation.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransfersService } from './transfers.service';

/** Domaine Transactions (épique 6). */
@Module({
  imports: [WalletsModule, ComplianceModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransfersService, InternalReconciliationService, { provide: FraudScoringPort, useClass: SimulatedFraudScoring }],
  exports: [TransactionsService, InternalReconciliationService, WalletsModule, ComplianceModule],
})
export class TransactionsModule {}
