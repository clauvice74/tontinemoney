import { Controller, Get, Header, HttpException, Inject } from '@nestjs/common';
import { GATEWAY_DEPS, type GatewayRuntime } from './tokens';

@Controller()
export class HealthController {
  constructor(@Inject(GATEWAY_DEPS) private readonly deps: GatewayRuntime) {}

  /** Vivacité : le processus répond. */
  @Get('health')
  health() {
    return { status: 'ok', service: 'api-gateway' };
  }

  /** Disponibilité : chaque service amont répond à son propre `/health/ready`. */
  @Get('health/ready')
  async ready() {
    const checks: Record<string, 'ok' | 'down'> = {};
    await Promise.all(
      this.deps.routes.upstreams().map(async (u) => {
        try {
          const r = await fetch(new URL('/health/ready', u), { signal: AbortSignal.timeout(2000) });
          checks[u] = r.ok ? 'ok' : 'down';
        } catch {
          checks[u] = 'down';
        }
      }),
    );
    const ok = Object.values(checks).every((c) => c === 'ok');
    if (!ok) throw new HttpException({ status: 'degraded', checks }, 503);
    return { status: 'ok', checks };
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics(): Promise<string> {
    return this.deps.metrics.registry.metrics();
  }
}
