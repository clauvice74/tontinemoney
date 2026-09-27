import { Module } from '@nestjs/common';
import { PaymentsModule } from '@tontine/payments';
import { TontinesModule } from '@tontine/tontines';
import { TransactionsModule } from '@tontine/transactions';
import { AdministrationConsumers } from './administration.consumers';
import {
  AdministrationController,
  PlatformReportsController,
  ReportsController,
} from './administration.controller';
import { PlatformReportsService } from './platform-reports.service';
import { ReportsService } from './reports.service';

/** Administration : rapports financiers, réconciliations, signalement de fraude (épique 10). */
@Module({
  imports: [TransactionsModule, PaymentsModule, TontinesModule],
  controllers: [ReportsController, PlatformReportsController, AdministrationController],
  providers: [ReportsService, PlatformReportsService, AdministrationConsumers],
  exports: [ReportsService],
})
export class AdministrationModule {}
