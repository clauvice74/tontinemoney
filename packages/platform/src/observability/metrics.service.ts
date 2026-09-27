import { Inject, Injectable } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { APP_CONFIG } from '../context/tokens';

/** Métriques Prometheus exposées sur /metrics. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly enabled: boolean;
  readonly httpRequests: Counter<'method' | 'route' | 'status_class'>;
  readonly httpDuration: Histogram<'method' | 'route'>;
  readonly outboxPending: Gauge;
  readonly outboxDead: Gauge;
  readonly activeHolds: Gauge;
  readonly jobRuns: Counter<'job' | 'status'>;
  readonly businessEvents: Counter<'type'>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.enabled = config.METRICS_ENABLED;
    if (this.enabled) collectDefaultMetrics({ register: this.registry });
    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'Requêtes HTTP',
      labelNames: ['method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Durée des requêtes HTTP',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.outboxPending = new Gauge({
      name: 'outbox_pending_events',
      help: 'Événements en attente',
      registers: [this.registry],
    });
    this.outboxDead = new Gauge({
      name: 'outbox_dead_events',
      help: 'Événements en DLQ',
      registers: [this.registry],
    });
    this.activeHolds = new Gauge({
      name: 'wallet_active_holds',
      help: 'Holds actifs',
      registers: [this.registry],
    });
    this.jobRuns = new Counter({
      name: 'job_runs_total',
      help: 'Exécutions de tâches planifiées',
      labelNames: ['job', 'status'],
      registers: [this.registry],
    });
    this.businessEvents = new Counter({
      name: 'business_events_total',
      help: 'Événements métier publiés',
      labelNames: ['type'],
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
