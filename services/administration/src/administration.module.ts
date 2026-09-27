import { Module } from '@nestjs/common';
import { PaymentsModule } from '@tontine/payments';
import { TransactionsModule } from '@tontine/transactions';
import { AdministrationConsumers } from './administration.consumers';
import { AdministrationController } from './administration.controller';

/**
 * Administration : paramètres, réconciliations, signalement de fraude (épique 10). Les rapports
 * et le tableau de bord sont passés au reporting (étape 6, A-54).
 */
@Module({
  imports: [TransactionsModule, PaymentsModule],
  controllers: [AdministrationController],
  providers: [AdministrationConsumers],
})
export class AdministrationModule {}
