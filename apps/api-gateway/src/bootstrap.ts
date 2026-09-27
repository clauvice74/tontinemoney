import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { type JWTVerifyGetKey } from 'jose';
import pino, { type Logger } from 'pino';
import { TokenVerifier } from './auth';
import { type GatewayConfig } from './config';
import { createGatewayHandler } from './gateway.handler';
import { HealthController } from './health.controller';
import { GatewayMetrics } from './metrics';
import { RouteTable } from './routes';
import { GATEWAY_DEPS, type GatewayRuntime } from './tokens';

export interface CreateGatewayOptions {
  config: GatewayConfig;
  /** Tests : clés de vérification locales au lieu du JWKS distant. */
  keys?: JWTVerifyGetKey;
  logger?: Logger;
}

@Module({})
class GatewayModule {
  static forRoot(deps: GatewayRuntime): DynamicModule {
    return {
      module: GatewayModule,
      controllers: [HealthController],
      providers: [{ provide: GATEWAY_DEPS, useValue: deps }],
    };
  }
}

/** Journaux JSON sans jeton, cookie ni corps de requête. */
export function gatewayLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'api-gateway' },
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export async function createGateway(
  options: CreateGatewayOptions,
): Promise<NestExpressApplication> {
  const { config } = options;
  const logger = options.logger ?? gatewayLogger(config.LOG_LEVEL);
  const deps: GatewayRuntime = {
    config,
    routes: new RouteTable(config.GATEWAY_ROUTES, config.API_UPSTREAM_URL, config.exposeDocs),
    verifier: options.keys
      ? new TokenVerifier(options.keys, config.JWT_ISSUER)
      : TokenVerifier.remote(config.jwksUrl, config.JWT_ISSUER),
    metrics: new GatewayMetrics(config.NODE_ENV !== 'test'),
    logger,
  };
  const app = await NestFactory.create<NestExpressApplication>(GatewayModule.forRoot(deps), {
    bodyParser: false,
    logger: config.NODE_ENV === 'test' ? false : ['error', 'warn'],
  });
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.enableCors({
    origin: [config.WEB_ORIGIN],
    credentials: true,
    exposedHeaders: ['X-Correlation-Id', 'Idempotent-Replayed', 'Retry-After'],
  });
  const handler = createGatewayHandler(deps);
  app.use(
    (req: Parameters<typeof handler>[0], res: Parameters<typeof handler>[1], next: () => void) => {
      handler(req, res, next).catch((e: unknown) => {
        logger.error({ msg: 'gateway.unhandled', err: e instanceof Error ? e.message : String(e) });
        if (!res.headersSent) res.writeHead(500).end();
      });
    },
  );
  app.enableShutdownHooks();
  return app;
}
