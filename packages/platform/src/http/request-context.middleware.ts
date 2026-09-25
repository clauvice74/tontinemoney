import { Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../context/request-context';
import { MetricsService } from '../observability/metrics.service';

const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Ouvre le contexte de requête (corrélation, IP, User-Agent), renvoie X-Correlation-Id,
 * mesure la durée et journalise l'accès.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && CORRELATION_PATTERN.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (!this.metrics.enabled) return;
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.httpRequests.inc({
        method: req.method,
        route,
        status_class: `${Math.floor(res.statusCode / 100)}xx`,
      });
      this.metrics.httpDuration.observe({ method: req.method, route }, seconds);
    });
    const devCountry = req.header('x-dev-country');
    RequestContext.run(
      {
        correlationId,
        source: 'http',
        ip: req.ip ?? req.socket.remoteAddress ?? null,
        userAgent: req.header('user-agent') ?? 'unknown',
        country: devCountry && /^[A-Z]{2}$/.test(devCountry) ? devCountry : null,
      },
      () => next(),
    );
  }
}
