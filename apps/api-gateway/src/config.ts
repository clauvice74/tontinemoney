import { z } from 'zod';

/** Route vers un service : le premier préfixe correspondant (le plus long) l'emporte. */
const routeSchema = z.object({
  prefix: z.string().regex(/^\/api\/v1\/[a-z0-9\-/]*$/, 'Préfixe attendu : /api/v1/…'),
  upstream: z.string().url(),
});
export type RouteDefinition = z.infer<typeof routeSchema>;

/** Règle d'autorisation grossière appliquée au bord (le service reste l'autorité). */
const edgeRuleSchema = z.object({
  prefix: z.string().startsWith('/api/v1/'),
  roles: z.array(z.string().min(1)).min(1),
});
export type EdgeRule = z.infer<typeof edgeRuleSchema>;

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

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const gatewayConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Service par défaut (monolithe `apps/api` tant qu'un domaine n'est pas extrait). */
  API_UPSTREAM_URL: z.string().url().default('http://localhost:4000'),
  /** Routes supplémentaires vers des services extraits, ex. `[{"prefix":"/api/v1/reports/","upstream":"http://localhost:4100"}]`. */
  GATEWAY_ROUTES: json(z.array(routeSchema)).default('[]'),
  /** JWKS du service d'authentification ; par défaut celui du service amont principal. */
  JWKS_URL: z.string().url().optional(),
  JWT_ISSUER: z.string().min(1).default('tontinemoney'),
  GATEWAY_EDGE_RULES: json(z.array(edgeRuleSchema)).default(
    JSON.stringify([
      { prefix: '/api/v1/admin/', roles: ['SUPER_ADMIN'] },
      { prefix: '/api/v1/reports/', roles: ['SUPER_ADMIN'] },
    ]),
  ),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  /**
   * Proxys de confiance devant le gateway (0 : le gateway est en frontal et ignore
   * X-Forwarded-For fourni par le client ; 1 : un proxy, ex. Next.js en développement).
   */
  GATEWAY_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  GATEWAY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  /** Limite plus stricte pour /api/v1/auth/* (connexion, OTP, inscription). */
  GATEWAY_AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  GATEWAY_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  GATEWAY_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(25 * 1024 * 1024),
  GATEWAY_CIRCUIT_FAILURES: z.coerce.number().int().min(1).default(5),
  GATEWAY_CIRCUIT_RESET_MS: z.coerce.number().int().min(100).default(10_000),
  /** Swagger (/api/docs) exposé via le gateway : désactivé en production par défaut. */
  GATEWAY_EXPOSE_DOCS: bool.optional(),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema> & {
  jwksUrl: string;
  exposeDocs: boolean;
};

export function loadGatewayConfig(env: Record<string, string | undefined>): GatewayConfig {
  const parsed = gatewayConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuration du gateway invalide : ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    jwksUrl: c.JWKS_URL ?? `${c.API_UPSTREAM_URL.replace(/\/$/, '')}/.well-known/jwks.json`,
    exposeDocs: c.GATEWAY_EXPOSE_DOCS ?? c.NODE_ENV !== 'production',
  };
}
