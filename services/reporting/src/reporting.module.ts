import { Module } from '@nestjs/common';
import { TontinesModule } from '@tontine/tontines';
import { AdminDashboardService } from './dashboard.service';
import { PlatformReportsService } from './platform-reports.service';
import { ProjectionConsumers, ProjectionService } from './projections';
import { ReportingConsumers } from './reporting.consumers';
import {
  AdminDashboardController,
  PlatformReportsController,
  ReportsController,
} from './reporting.controller';
import { ReportsService } from './reports.service';

/**
 * Reporting (étape 6, A-54) : projections alimentées par les instantanés d'état publiés par
 * les domaines, rapports par tontine et de plateforme, tableau de bord du super-admin. Aucune
 * lecture des tables d'un autre domaine ; l'autorisation d'un rapport de tontine est vérifiée
 * auprès du domaine Tontine (contrôle synchrone exact).
 */
@Module({
  imports: [TontinesModule],
  controllers: [ReportsController, PlatformReportsController, AdminDashboardController],
  providers: [
    ProjectionService,
    ProjectionConsumers,
    ReportsService,
    PlatformReportsService,
    AdminDashboardService,
    ReportingConsumers,
  ],
  exports: [ReportsService, ProjectionService],
})
export class ReportingModule {}
