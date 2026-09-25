import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/client';

export * from './generated/client';
export { Prisma, PrismaClient };

export type TxClient = Prisma.TransactionClient;
export type DbClient = PrismaClient | TxClient;

export interface CreatePrismaOptions {
  url: string;
  poolSize?: number;
  log?: boolean;
}

/** Options du client Prisma 7 (sans moteur natif) connecté via l'adaptateur `pg`. */
export function prismaClientOptions(options: CreatePrismaOptions) {
  // Session en UTC : l'adaptateur transmet les horodatages sans fuseau.
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.poolSize ?? 10,
    options: '-c TimeZone=UTC',
  });
  return {
    adapter,
    log: options.log ? (['query', 'warn', 'error'] as const) : (['warn', 'error'] as const),
  } as const;
}

export function createPrismaClient(options: CreatePrismaOptions): PrismaClient {
  const o = prismaClientOptions(options);
  return new PrismaClient({ adapter: o.adapter, log: [...o.log] });
}

/**
 * Vrai si l'erreur est un conflit de sérialisation / interblocage PostgreSQL :
 * la transaction peut être rejouée (R-TRX-05, R-WAL-06).
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return true;
    const meta = JSON.stringify(error.meta ?? {});
    if (/40001|40P01|could not serialize|deadlock/i.test(meta)) return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /40001|40P01|could not serialize access|deadlock detected|write conflict/i.test(msg);
}

/** Vrai si l'erreur est une violation de contrainte d'unicité. */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    if (!field) return true;
    return JSON.stringify(error.meta ?? {}).includes(field);
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /23505|unique constraint/i.test(msg) && (!field || msg.includes(field));
}

/** Vrai si l'erreur provient d'une contrainte CHECK (ex. solde négatif) ou d'un trigger append-only. */
export function isCheckViolation(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const meta =
    error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : '';
  return /23514|check constraint|append-only/i.test(`${msg} ${meta}`);
}

/** Tables tronquées entre les tests d'intégration (ordre sans importance avec CASCADE). */
export const ALL_TABLES = [
  'outbox_events',
  'processed_events',
  'idempotency_keys',
  'audit_logs',
  'job_runs',
  'auth_users',
  'auth_password_history',
  'auth_tokens',
  'auth_refresh_sessions',
  'auth_login_attempts',
  'auth_recovery_codes',
  'auth_known_devices',
  'auth_access_requests',
  'mbr_members',
  'mbr_audit_logs',
  'kyc_requests',
  'kyc_documents',
  'kyc_checks',
  'kyc_agent_actions',
  'kyc_biometric_templates',
  'kyc_duplicate_alerts',
  'kyc_aml_matches',
  'kyc_aml_whitelist',
  'ton_tontines',
  'ton_members',
  'ton_invitations',
  'ton_cycles',
  'ton_contributions',
  'ton_priority_requests',
  'wal_wallets',
  'wal_movements',
  'wal_holds',
  'wal_status_history',
  'trx_transactions',
  'trx_audit_logs',
  'trx_reconciliation_reports',
  'pay_payments',
  'pay_status_history',
  'pay_webhook_events',
  'ntf_templates',
  'ntf_notifications',
  'ntf_outbound_messages',
  'cmp_rules',
  'cmp_rule_history',
  'cmp_violations',
  'adm_tontine_accounts',
  'adm_messages',
] as const;

export async function truncateAll(
  client: PrismaClient,
  keep: readonly string[] = [],
): Promise<void> {
  const tables = ALL_TABLES.filter((t) => !keep.includes(t))
    .map((t) => `"${t}"`)
    .join(', ');
  await client.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
