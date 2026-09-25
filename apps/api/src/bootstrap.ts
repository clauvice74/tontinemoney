import { type INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { type AppConfig } from '@tontine/config';
import {
  AppLogger,
  type Clock,
  type KvStore,
  ProblemDetailsFilter,
  createPino,
} from '@tontine/platform';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

export interface CreateAppOptions {
  config: AppConfig;
  clock?: Clock;
  kv?: KvStore;
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = new DocumentBuilder()
    .setTitle('TontineMoney API')
    .setDescription(
      'API REST versionnée du MVP TontineMoney (monolithe modulaire). Erreurs au format Problem Details (RFC 9457). ' +
        'Montants en chaînes décimales (unités majeures) + devise ISO 4217. En-tête Idempotency-Key obligatoire sur les POST financiers.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addCookieAuth('tm_rt')
    .build();
  return SwaggerModule.createDocument(app, doc);
}

/** Configuration HTTP commune (application et tests). */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({
    origin: [config.WEB_ORIGIN],
    credentials: true,
    exposedHeaders: ['X-Correlation-Id', 'Idempotent-Replayed', 'Retry-After'],
  });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
      { path: '.well-known/jwks.json', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter(config.NODE_ENV !== 'production'));
  app.enableShutdownHooks();
}

export async function createApp(options: CreateAppOptions): Promise<NestExpressApplication> {
  const logger = new AppLogger(createPino(options.config.LOG_LEVEL));
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(options), {
    logger: options.config.NODE_ENV === 'test' ? false : logger,
    bufferLogs: options.config.NODE_ENV !== 'test',
    bodyParser: false,
    // Corps brut conservé pour la vérification des signatures de webhooks PSP
    rawBody: true,
  });
  configureApp(app, options.config);
  if (options.config.NODE_ENV !== 'production' || process.env['SWAGGER_ENABLED'] === 'true') {
    SwaggerModule.setup('api/docs', app, () => buildOpenApi(app), {
      jsonDocumentUrl: 'api/docs-json',
    });
  }
  return app;
}
