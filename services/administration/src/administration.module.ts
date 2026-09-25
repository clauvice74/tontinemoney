import { Module } from '@nestjs/common';
import { PaymentsModule } from '@tontine/payments';
import { TontinesModule } from '@tontine/tontines';
import { TransactionsModule } from '@tontine/transactions';
import { AdministrationConsumers } from './administration.consumers';
import { AdministrationController, ReportsController } from './administration.controller';
import { ReportsService } from './reports.service';

/** Administration : rapports financiers, réconciliations, signalement de fraude (épique 10). */
@Module({
  imports: [TransactionsModule, PaymentsModule, TontinesModule],
  controllers: [ReportsController, AdministrationController],
  providers: [ReportsService, AdministrationConsumers],
  exports: [ReportsService],
})
export class AdministrationModule {}
