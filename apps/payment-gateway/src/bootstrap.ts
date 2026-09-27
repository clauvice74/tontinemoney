import {
  Controller,
  type DynamicModule,
  Get,
  Header,
  HttpException,
  Inject,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type PrismaClient, createPrismaClient } from '@tontine/database';
import helmet from 'helmet';
import pino, { type Logger } from 'pino';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { type PaymentGatewayConfig } from './config';
import { Forwarder } from './forwarder';
import { ReceiptStore } from './receipts';
import {
  FlutterwaveVerifier,
  PaystackVerifier,
  SimulatedPspVerifier,
  type WebhookVerifier,
} from './verifiers';
import { createWebhookHandler } from './webhook.handler';

const RUNTIME = Symbol('PAYMENT_GATEWAY_RUNTIME');
interface Runtime {
  config: PaymentGatewayConfig;
  prisma: PrismaClient;
  registry: Registry;
}

@Controller()
class HealthController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'payment-gateway' };
  }

  /** Base de données (journal des webhooks) et Payment Service joignables. */
  @Get('health/ready')
  async ready() {
    const checks: Record<string, 'ok' | 'down'> = { database: 'down', paymentService: 'down' };
    try {
      await this.rt.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'ok';
    } catch {
      /* down */
    }
    try {
      const r = await fetch(new URL('/health/ready', this.rt.config.PAYMENT_SERVICE_URL), {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) checks['paymentService'] = 'ok';
    } catch {
      /* down */
    }
    if (Object.values(checks).some((c) => c !== 'ok'))
      throw new HttpException({ status: 'degraded', checks }, 503);
    return { status: 'ok', checks };
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics(): Promise<string> {
    return this.rt.registry.metrics();
  }
}

@Module({})
class PaymentGatewayModule {
  static forRoot(rt: Runtime): DynamicModule {
    return {
      module: PaymentGatewayModule,
      controllers: [HealthController],
      providers: [{ provide: RUNTIME, useValue: rt }],
    };
  }
}

/** Vérificateurs des seuls prestataires activés ; les autres répondent 404. */
export function verifiersFor(config: PaymentGatewayConfig): Map<string, WebhookVerifier> {
  const all: WebhookVerifier[] = [
    new SimulatedPspVerifier(
      'simulated',
      config.PSP_WEBHOOK_SECRET,
      config.PSP_WEBHOOK_TOLERANCE_SECONDS,
    ),
    new SimulatedPspVerifier(
      'simulated-backup',
      config.PSP_WEBHOOK_SECRET,
      config.PSP_WEBHOOK_TOLERANCE_SECONDS,
    ),
    new FlutterwaveVerifier(config.FLUTTERWAVE_WEBHOOK_HASH),
    new PaystackVerifier(config.PAYSTACK_SECRET_KEY),
  ];
  return new Map(
    all
      .filter((v) => config.PAYMENT_GATEWAY_PROVIDERS.includes(v.provider))
      .map((v) => [v.provider, v]),
  );
}

export interface CreatePaymentGatewayOptions {
  config: PaymentGatewayConfig;
  prisma?: PrismaClient;
  logger?: Logger;
  now?: () => Date;
  /** Tests : attente entre réessais. */
  sleep?: (ms: number) => Promise<void>;
}

export async function createPaymentGateway(
  options: CreatePaymentGatewayOptions,
): Promise<NestExpressApplication> {
  const { config } = options;
  const logger =
    options.logger ??
    pino({
      level: config.LOG_LEVEL,
      base: { service: 'payment-gateway' },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  const prisma = options.prisma ?? createPrismaClient({ url: config.DATABASE_URL, poolSize: 5 });
  const registry = new Registry();
  if (config.NODE_ENV !== 'test')
    collectDefaultMetrics({ register: registry, prefix: 'payment_gateway_' });
  const webhooks = new Counter({
    name: 'payment_gateway_webhooks_total',
    help: 'Webhooks reçus par prestataire et résultat',
    labelNames: ['provider', 'result'] as const,
    registers: [registry],
  });

  const app = await NestFactory.create<NestExpressApplication>(
    PaymentGatewayModule.forRoot({ config, prisma, registry }),
    { bodyParser: false, logger: config.NODE_ENV === 'test' ? false : ['error', 'warn'] },
  );
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  const handler = createWebhookHandler({
    verifiers: verifiersFor(config),
    receipts: new ReceiptStore(
      prisma,
      // délai × tentatives + attentes exponentielles, doublé par sécurité
      2 *
        (config.PAYMENT_GATEWAY_FORWARD_TIMEOUT_MS * config.PAYMENT_GATEWAY_FORWARD_ATTEMPTS +
          2000),
    ),
    forwarder: new Forwarder(
      config.PAYMENT_SERVICE_URL,
      config.INTERNAL_SERVICE_SECRET,
      config.PAYMENT_GATEWAY_FORWARD_TIMEOUT_MS,
      config.PAYMENT_GATEWAY_FORWARD_ATTEMPTS,
      options.sleep,
    ),
    logger,
    webhooks,
    maxBodyBytes: config.PAYMENT_GATEWAY_MAX_BODY_BYTES,
    ratePerMinute: config.PAYMENT_GATEWAY_RATE_LIMIT_PER_MINUTE,
    trustProxyHops: config.PAYMENT_GATEWAY_TRUST_PROXY_HOPS,
    ...(options.now ? { now: options.now } : {}),
  });
  app.use(
    (req: Parameters<typeof handler>[0], res: Parameters<typeof handler>[1], next: () => void) => {
      handler(req, res, next).catch((e: unknown) => {
        logger.error({
          msg: 'payment-gateway.unhandled',
          err: e instanceof Error ? e.message : String(e),
        });
        // 503 : le PSP réessaiera ; rien n'a été transmis sans être journalisé
        if (!res.headersSent) res.writeHead(503, { 'Retry-After': '30' }).end();
      });
    },
  );
  app.enableShutdownHooks();
  if (!options.prisma) {
    const close = app.close.bind(app);
    app.close = async () => {
      await close();
      await prisma.$disconnect();
    };
  }
  return app;
}
