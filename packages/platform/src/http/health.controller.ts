import { Controller, Get, HttpCode, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../context/prisma.service';
import { OutboxRelay } from '../events/outbox-relay';
import { KvStore } from '../kv/kv-store';
import { MetricsService } from '../observability/metrics.service';
import { Public } from './decorators';
import { type Response } from 'express';

/** Vivacité, disponibilité (base, KV) et métriques Prometheus : commun à chaque processus. */
@ApiExcludeController()
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kv: KvStore,
    private readonly metrics: MetricsService,
    private readonly relay: OutboxRelay,
  ) {}

  @Get('health')
  @Public()
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @Public()
  async ready(@Res() res: Response) {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'ok';
    } catch {
      checks['database'] = 'down';
    }
    try {
      await this.kv.set('health:ping', '1', 5);
      checks['kv'] = 'ok';
    } catch {
      checks['kv'] = 'down';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', checks });
  }

  @Get('metrics')
  @Public()
  async metricsEndpoint(@Res() res: Response) {
    void this.relay;
    res.type('text/plain; version=0.0.4').send(await this.metrics.render());
  }
}
