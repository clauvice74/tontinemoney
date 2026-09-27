import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Métriques Prometheus du gateway (libellés bornés : service, méthode, statut). */
export class GatewayMetrics {
  readonly registry = new Registry();

  readonly requests = new Counter({
    name: 'gateway_http_requests_total',
    help: 'Requêtes traitées par le gateway',
    labelNames: ['route', 'method', 'status'] as const,
    registers: [this.registry],
  });

  readonly duration = new Histogram({
    name: 'gateway_http_request_duration_seconds',
    help: 'Durée des requêtes (gateway + service amont)',
    labelNames: ['route', 'method'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly rejected = new Counter({
    name: 'gateway_rejected_total',
    help: 'Requêtes refusées par le gateway, par motif',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  readonly circuit = new Gauge({
    name: 'gateway_circuit_open',
    help: 'Disjoncteur ouvert (1) ou fermé (0) par service amont',
    labelNames: ['upstream'] as const,
    registers: [this.registry],
  });

  constructor(defaults = true) {
    if (defaults) collectDefaultMetrics({ register: this.registry, prefix: 'gateway_' });
  }
}
