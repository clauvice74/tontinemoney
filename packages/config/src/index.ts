import { z } from 'zod';

/**
 * Schéma de configuration (variables d'environnement). Toute variable est validée au démarrage :
 * l'API refuse de démarrer avec une configuration invalide.
 */
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_PORT: z.coerce.number().int().default(4000),
    /** Port HTTP du reporting-service extrait (étape 7). */
    REPORTING_SERVICE_PORT: z.coerce.number().int().default(4100),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    APP_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    KV_DRIVER: z.enum(['redis', 'memory']).default('redis'),
    EVENT_TRANSPORT: z.enum(['inprocess', 'postgres', 'kafka']).default('inprocess'),
    /**
     * Groupe de consommateurs du transport PostgreSQL (étape 7, A-55) : un par service extrait
     * (`api` pour le monolithe, `reporting`, …) ; chacun lit le journal depuis sa position.
     */
    EVENT_GROUP: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,40}$/)
      .default('api'),
    KAFKA_BROKERS: z.string().default('localhost:19092'),
    KAFKA_CLIENT_ID: z.string().min(1).default('tontinemoney-api'),
    KAFKA_GROUP_ID: z.string().min(1).default('tontinemoney-api'),
    KAFKA_TOPIC_PARTITIONS: z.coerce.number().int().min(1).max(64).default(3),
    /** Producteur idempotent Kafka (A-52) : false par défaut (incompatible Redpanda + kafkajs). */
    KAFKA_IDEMPOTENT_PRODUCER: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Tentatives de traitement d'un message Kafka avant rejet (file des messages rejetés). */
    EVENT_CONSUMER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(250),
    JWT_PRIVATE_KEY_PEM: z.string().optional().default(''),
    JWT_PUBLIC_KEY_PEM: z.string().optional().default(''),
    JWT_KEY_ID: z.string().optional().default(''),
    JWT_ISSUER: z.string().default('tontinemoney'),
    JWT_KEYS_DIR: z.string().default('.keys'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).default(604800),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    COOKIE_SECURE: bool.default('false'),
    DATA_ENCRYPTION_KEY: z.string().min(40),
    DOCUMENT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    DOCUMENT_STORAGE_DIR: z.string().default('./storage/kyc'),
    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET_KYC: z.string().default('kyc-documents'),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    EMAIL_DRIVER: z.enum(['smtp', 'memory']).default('smtp'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    EMAIL_FROM: z.string().default('TontineMoney <no-reply@tontinemoney.local>'),
    SMS_DRIVER: z.enum(['simulated']).default('simulated'),
    PSP_DEFAULT_PROVIDER: z.enum(['simulated']).default('simulated'),
    PSP_WEBHOOK_SECRET: z.string().min(16),
    PSP_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).default(300),
    /**
     * Livraison des webhooks du PSP simulé : `inprocess` (tests, sans gateway) ou `http` vers le
     * Payment Gateway (chemin réel : signature, rejeu, normalisation, appel interne signé).
     */
    PSP_WEBHOOK_DELIVERY: z.enum(['inprocess', 'http']).default('inprocess'),
    PAYMENT_GATEWAY_URL: z.string().url().default('http://localhost:8090'),
    /** Secret HMAC des appels internes de service à service (jamais exposés par l'API Gateway). */
    INTERNAL_SERVICE_SECRET: z.string().min(32),
    /** Services extraits autorisés à appeler les ports de ce processus (étape 7, A-55). */
    INTERNAL_PORT_CALLERS: z
      .string()
      .default('reporting')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    /** Nom de ce service (appelant signé des appels internes). */
    SERVICE_NAME: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,40}$/)
      .default('api'),
    /**
     * Domaines servis par leur propre processus (étape 7, A-55), retirés du monolithe :
     * ex. `reporting`. Exige un transport d'événements inter-processus (postgres ou kafka).
     */
    EXTRACTED_SERVICES: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(['reporting']))),
    /** Processus propriétaire des ports, pour un service extrait (monolithe par défaut). */
    PORTS_UPSTREAM_URL: z.string().url().default('http://localhost:4000'),
    /** Squelettes réels (désactivés) : utilisés uniquement pour vérifier des webhooks de test. */
    FLUTTERWAVE_WEBHOOK_HASH: z.string().default(''),
    PAYSTACK_SECRET_KEY: z.string().default(''),
    /** US-6.6 / US-7.6 : écart cumulé (unités mineures) au-delà duquel une alerte est levée. */
    RECONCILIATION_ALERT_THRESHOLD_MINOR: z.coerce.number().int().min(0).default(0),
    SCHEDULER_ENABLED: bool.default('true'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),
    METRICS_ENABLED: bool.default('true'),
  })
  .superRefine((env, ctx) => {
    // Un service extrait ne reçoit pas les événements d'un transport limité au processus
    if (env.EXTRACTED_SERVICES.length > 0 && env.EVENT_TRANSPORT === 'inprocess') {
      ctx.addIssue({
        code: 'custom',
        path: ['EVENT_TRANSPORT'],
        message: 'Services extraits : transport postgres ou kafka requis (A-55)',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.JWT_PRIVATE_KEY_PEM || !env.JWT_PUBLIC_KEY_PEM) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_PRIVATE_KEY_PEM'],
          message: 'Clés JWT obligatoires en production',
        });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'Cookies sécurisés obligatoires en production',
        });
      }
      if (env.INTERNAL_SERVICE_SECRET.startsWith('dev-only')) {
        ctx.addIssue({
          code: 'custom',
          path: ['INTERNAL_SERVICE_SECRET'],
          message: 'Secret interne de dev interdit en production',
        });
      }
      if (env.PSP_WEBHOOK_SECRET.startsWith('dev-only')) {
        ctx.addIssue({
          code: 'custom',
          path: ['PSP_WEBHOOK_SECRET'],
          message: 'Secret de webhook de dev interdit en production',
        });
      }
      if (env.BCRYPT_COST < 12) {
        ctx.addIssue({
          code: 'custom',
          path: ['BCRYPT_COST'],
          message: 'BCRYPT_COST ≥ 12 en production',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuration invalide :\n - ${issues.join('\n - ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  return parsed.data;
}

/** Configuration de test (aucun service externe réel). */
export function testConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL:
      process.env['DATABASE_URL_TEST'] ??
      'postgresql://tontine:tontine@localhost:5432/tontinemoney_test',
    KV_DRIVER: 'memory',
    EMAIL_DRIVER: 'memory',
    BCRYPT_COST: '4',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    PSP_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
    INTERNAL_SERVICE_SECRET: 'test-internal-secret-0123456789abcdef',
    SCHEDULER_ENABLED: 'false',
    METRICS_ENABLED: 'false',
    DOCUMENT_STORAGE_DIR: './storage/test-kyc',
    ...overrides,
  });
}
