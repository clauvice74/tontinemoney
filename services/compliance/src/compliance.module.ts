import { Module } from '@nestjs/common';
import { ComplianceCasesService } from './cases.service';
import { ComplianceConsumers } from './compliance.consumers';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

/** Domaine Conformité (épique 9). */
@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, ComplianceCasesService, ComplianceConsumers],
  exports: [ComplianceService],
})
export class ComplianceModule {}
