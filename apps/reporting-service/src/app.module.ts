import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  HealthController,
  JwtAuthGuard,
  PlatformModule,
  type PlatformModuleOptions,
  RemotePortsModule,
  RequestContextMiddleware,
  RolesGuard,
} from '@tontine/platform';
import { ReportingModule } from '@tontine/reporting';

/**
 * Reporting-service (étape 7, A-55) : premier domaine dans son propre processus. Projections
 * alimentées par le journal d'événements (groupe `reporting`) ; jetons, comptes, membres et
 * droits sur les tontines obtenus par appels internes signés auprès de leurs propriétaires.
 */
@Module({})
export class ReportingServiceModule implements NestModule {
  static forRoot(options: PlatformModuleOptions): DynamicModule {
    return {
      module: ReportingServiceModule,
      imports: [
        PlatformModule.forRoot(options),
        RemotePortsModule.forRoot({
          baseUrl: options.config.PORTS_UPSTREAM_URL,
          caller: options.config.SERVICE_NAME,
          ports: ['auth.tokens', 'auth.accounts', 'members.query', 'tontines.access'],
        }),
        ReportingModule,
      ],
      controllers: [HealthController],
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
