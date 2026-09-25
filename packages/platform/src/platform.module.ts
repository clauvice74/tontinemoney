import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { type AppConfig } from '@tontine/config';
import { AuditService } from './audit/audit.service';
import { Clock, SystemClock } from './context/clock';
import { PrismaService } from './context/prisma.service';
import { APP_CONFIG } from './context/tokens';
import { UnitOfWork } from './context/unit-of-work';
import { EventDispatcher } from './events/event-dispatcher';
import { EventHandlerExplorer } from './events/event-handler.explorer';
import { OutboxRelay } from './events/outbox-relay';
import { OutboxService } from './events/outbox.service';
import { AccessDeniedMonitor } from './http/access-denied.monitor';
import { IdempotencyInterceptor } from './idempotency/idempotent.interceptor';
import { IdempotencyService } from './idempotency/idempotency.service';
import { JobRegistry } from './jobs/job-registry';
import { KvStore, MemoryKvStore, RedisKvStore } from './kv/kv-store';
import { RateLimiter } from './kv/rate-limiter';
import { MetricsService } from './observability/metrics.service';

export interface PlatformModuleOptions {
  config: AppConfig;
  /** Horloge à injecter (FixedClock dans les tests). */
  clock?: Clock;
  /** Magasin clé-valeur à injecter (MemoryKvStore dans les tests). */
  kv?: KvStore;
}

/** Noyau transverse partagé par tous les domaines. */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(options: PlatformModuleOptions): DynamicModule {
    const clock = options.clock ?? new SystemClock();
    const providers: Provider[] = [
      { provide: APP_CONFIG, useValue: options.config },
      { provide: Clock, useValue: clock },
      {
        provide: KvStore,
        useFactory: () =>
          options.kv ??
          (options.config.KV_DRIVER === 'memory'
            ? new MemoryKvStore(clock)
            : new RedisKvStore(options.config.REDIS_URL)),
      },
      PrismaService,
      UnitOfWork,
      MetricsService,
      OutboxService,
      EventDispatcher,
      EventHandlerExplorer,
      OutboxRelay,
      IdempotencyService,
      IdempotencyInterceptor,
      AuditService,
      AccessDeniedMonitor,
      RateLimiter,
      JobRegistry,
    ];
    return {
      module: PlatformModule,
      imports: [DiscoveryModule],
      providers,
      exports: providers.filter((p): p is Exclude<Provider, never> => p !== EventHandlerExplorer).map((p) =>
        typeof p === 'function' ? p : (p as { provide: unknown }).provide,
      ) as never,
    };
  }
}
