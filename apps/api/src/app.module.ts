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
import { ComplianceModule } from '@tontine/compliance';
import { KycModule } from '@tontine/kyc';
import { MembersModule, MembersPortsModule } from '@tontine/members';
import { NotificationsModule } from '@tontine/notifications';
import { PaymentsModule } from '@tontine/payments';
import {
  JwtAuthGuard,
  PlatformModule,
  type PlatformModuleOptions,
  RequestContextMiddleware,
  RolesGuard,
} from '@tontine/platform';
import { TontinesModule, TontinesPortsModule } from '@tontine/tontines';
import { TransactionsModule } from '@tontine/transactions';
import { WalletsModule } from '@tontine/wallets';
import { HealthController } from './ops/health.controller';
import { OpsController } from './ops/ops.controller';

/** Composition du monolithe modulaire : un module NestJS par domaine métier. */
@Module({})
export class AppModule implements NestModule {
  static forRoot(options: PlatformModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(options),
        // Ports globaux (implémentés par les domaines propriétaires)
        MembersPortsModule,
        TontinesPortsModule,
        AdministrationPortsModule,
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
