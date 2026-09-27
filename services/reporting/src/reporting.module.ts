import { Module } from '@nestjs/common';
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
 * lecture des tables d'un autre domaine ; ports uniquement (TONTINE_ACCESS, MEMBER_QUERY,
 * ACCOUNT_DIRECTORY) — fournis en processus par le monolithe, ou par appels internes signés
 * quand le reporting tourne dans son propre processus (étape 7, A-55).
 */
@Module({
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
