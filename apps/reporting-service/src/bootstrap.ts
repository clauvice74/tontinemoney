import { RequestMethod, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type AppConfig } from '@tontine/config';
import {
  AppLogger,
  type Clock,
  type KvStore,
  ProblemDetailsFilter,
  createPino,
} from '@tontine/platform';
import helmet from 'helmet';
import { ReportingServiceModule } from './app.module';

export interface CreateReportingServiceOptions {
  config: AppConfig;
  clock?: Clock;
  kv?: KvStore;
}

/** Application HTTP du reporting-service (appelée derrière l'API Gateway uniquement). */
export async function createReportingService(
  options: CreateReportingServiceOptions,
): Promise<NestExpressApplication> {
  const { config } = options;
  if (config.EVENT_TRANSPORT === 'inprocess')
    throw new Error('reporting-service : EVENT_TRANSPORT postgres ou kafka requis (A-55)');
  const app = await NestFactory.create<NestExpressApplication>(
    ReportingServiceModule.forRoot(options),
    {
      logger:
        config.NODE_ENV === 'test'
          ? false
          : new AppLogger(createPino(config.LOG_LEVEL, 'reporting-service')),
      bufferLogs: config.NODE_ENV !== 'test',
    },
  );
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter(config.NODE_ENV !== 'production'));
  app.enableShutdownHooks();
  return app;
}
