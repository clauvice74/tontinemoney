import { Module } from '@nestjs/common';
import { DataCipher } from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { APP_CONFIG } from '@tontine/platform';
import { AmlScreeningService } from './aml-screening.service';
import { KycMaintenanceService } from './expiry.service';
import { KycConsumers } from './kyc.consumers';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycPipelineService } from './pipeline.service';
import {
  AmlScreeningProvider,
  BiometricTemplateProvider,
  DocumentQualityProvider,
  FaceMatchProvider,
  OcrProvider,
  SimulatedAmlProvider,
  SimulatedBiometricProvider,
  SimulatedFaceMatchProvider,
  SimulatedOcrProvider,
  SimulatedQualityProvider,
  SimulatedTamperDetection,
  TamperDetectionProvider,
} from './providers/providers';
import { KycReviewService } from './review.service';
import { ScreeningController } from './screening.controller';
import { DocumentStorage, LocalDocumentStorage, S3DocumentStorage } from './storage';

/** Domaine KYC (épique 3) — uniquement des adaptateurs simulés déterministes en V1. */
@Module({
  controllers: [KycController, ScreeningController],
  providers: [
    {
      provide: DocumentStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const cipher = new DataCipher(config.DATA_ENCRYPTION_KEY);
        return config.DOCUMENT_STORAGE_DRIVER === 's3'
          ? new S3DocumentStorage(cipher, config)
          : new LocalDocumentStorage(cipher, config.DOCUMENT_STORAGE_DIR);
      },
    },
    { provide: DocumentQualityProvider, useClass: SimulatedQualityProvider },
    { provide: OcrProvider, useClass: SimulatedOcrProvider },
    { provide: FaceMatchProvider, useClass: SimulatedFaceMatchProvider },
    { provide: BiometricTemplateProvider, useClass: SimulatedBiometricProvider },
    { provide: TamperDetectionProvider, useClass: SimulatedTamperDetection },
    SimulatedAmlProvider,
    { provide: AmlScreeningProvider, useExisting: SimulatedAmlProvider },
    KycService,
    KycPipelineService,
    KycReviewService,
    KycMaintenanceService,
    AmlScreeningService,
    KycConsumers,
  ],
  exports: [KycService, DocumentStorage, SimulatedAmlProvider],
})
export class KycModule {}
