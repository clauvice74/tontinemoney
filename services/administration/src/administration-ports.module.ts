import { Global, Module } from '@nestjs/common';
import { CONFIGURATION } from '@tontine/platform';
import { ConfigurationService } from './configuration.service';

/** Port global CONFIGURATION (paramètres modifiables à chaud, A-50), fourni par admin-service. */
@Global()
@Module({
  providers: [ConfigurationService, { provide: CONFIGURATION, useExisting: ConfigurationService }],
  exports: [CONFIGURATION, ConfigurationService],
})
export class AdministrationPortsModule {}
