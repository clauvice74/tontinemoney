import { Module } from '@nestjs/common';
import { ComplianceConsumers } from './compliance.consumers';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

/** Domaine Conformité (épique 9). */
@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, ComplianceConsumers],
  exports: [ComplianceService],
})
export class ComplianceModule {}
