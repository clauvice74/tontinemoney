import { z } from 'zod';

const json = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'JSON invalide' });
        return z.NEVER;
      }
    })
    .pipe(schema);

export const paymentGatewayConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    PAYMENT_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8090),
    DATABASE_URL: z.string().url(),
    /** Payment Service (monolithe `apps/api` tant qu'il n'est pas extrait). */
    PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:4000'),
    INTERNAL_SERVICE_SECRET: z.string().min(32),
    /** Secret HMAC des PSP simulés (mêmes valeurs que le Payment Service). */
    PSP_WEBHOOK_SECRET: z.string().min(16),
    PSP_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).default(300),
    /** Prestataires acceptés. Les intégrations réelles restent désactivées (A-47). */
    PAYMENT_GATEWAY_PROVIDERS: json(z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).min(1)).default(
      '["simulated","simulated-backup"]',
    ),
    FLUTTERWAVE_WEBHOOK_HASH: z.string().default(''),
    PAYSTACK_SECRET_KEY: z.string().default(''),
    PAYMENT_GATEWAY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    PAYMENT_GATEWAY_MAX_BODY_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(64 * 1024),
    PAYMENT_GATEWAY_FORWARD_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
    PAYMENT_GATEWAY_FORWARD_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    /** 0 : le gateway reçoit directement les PSP (X-Forwarded-For ignoré). */
    PAYMENT_GATEWAY_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== 'production') return;
    for (const key of ['INTERNAL_SERVICE_SECRET', 'PSP_WEBHOOK_SECRET'] as const)
      if (c[key].startsWith('dev-only'))
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Secret de dev interdit en production',
        });
    for (const p of c.PAYMENT_GATEWAY_PROVIDERS)
      if (p === 'flutterwave' || p === 'paystack')
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_GATEWAY_PROVIDERS'],
          message: `Intégration ${p} non activée dans cette version`,
        });
  });

export type PaymentGatewayConfig = z.infer<typeof paymentGatewayConfigSchema>;

export function loadPaymentGatewayConfig(
  env: Record<string, string | undefined>,
): PaymentGatewayConfig {
  const parsed = paymentGatewayConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuration du Payment Gateway invalide : ${issues}`);
  }
  return parsed.data;
}
