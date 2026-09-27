import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdministrationModule, AdministrationPortsModule } from '@tontine/administration';
import { AuthModule } from '@tontine/auth-service';
import { CommunicationModule } from '@tontine/communication';
import { ReportingModule } from '@tontine/reporting';
import { ComplianceModule } from '@tontine/compliance';
import { KycModule } from '@tontine/kyc';
import { MembersModule, MembersPortsModule } from '@tontine/members';
import { NotificationsModule } from '@tontine/notifications';
import { PaymentsModule } from '@tontine/payments';
import {
  HealthController,
  JwtAuthGuard,
  PlatformModule,
  PortRpcServerModule,
  type PlatformModuleOptions,
  RequestContextMiddleware,
  RolesGuard,
} from '@tontine/platform';
import { TontinesModule, TontinesPortsModule } from '@tontine/tontines';
import { TransactionsModule, TransactionsPortsModule } from '@tontine/transactions';
import { WalletsModule, WalletsPortsModule } from '@tontine/wallets';
import { OpsController } from './ops/ops.controller';

/** Domaines extraits dans leur propre processus (étape 7, A-55) : retirés du monolithe. */
const EXTRACTABLE = { reporting: ReportingModule } as const;

/** Composition du monolithe modulaire : un module NestJS par domaine métier. */
@Module({})
export class AppModule implements NestModule {
  static forRoot(options: PlatformModuleOptions): DynamicModule {
    const extracted = new Set<string>(options.config.EXTRACTED_SERVICES);
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(options),
        // Ports globaux (implémentés par les domaines propriétaires)
        MembersPortsModule,
        TontinesPortsModule,
        AdministrationPortsModule,
        TransactionsPortsModule,
        WalletsPortsModule,
        // Domaines
        CommunicationModule,
        NotificationsModule,
        AuthModule,
        MembersModule,
        WalletsModule,
        ComplianceModule,
        TransactionsModule,
        KycModule,
        TontinesModule,
        PaymentsModule,
        AdministrationModule,
        ...Object.entries(EXTRACTABLE)
          .filter(([name]) => !extracted.has(name))
          .map(([, m]) => m),
        // Ports de ce processus appelables par les services extraits (appels internes signés)
        PortRpcServerModule,
      ],
      controllers: [HealthController, OpsController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
