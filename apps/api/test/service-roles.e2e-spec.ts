import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestContext, createTestContext } from './support/test-app';

/**
 * Extraction, étape 4 : un schéma par service et des rôles PostgreSQL au moindre privilège
 * (packages/database/scripts/service-roles.mjs). Chaque vérification adopte le rôle dans une
 * transaction toujours annulée.
 */
let ctx: TestContext;

const ROLLBACK = new Error('rollback');

/** Vrai si `sql` s'exécute sous `role` ; faux sur refus de droit (42501). */
async function can(role: string, sql: string): Promise<boolean> {
  try {
    await ctx.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      await tx.$executeRawUnsafe(sql);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK) return true;
    if (/permission denied|42501/i.test(e instanceof Error ? e.message : String(e))) return false;
    throw e;
  }
  return true;
}

beforeAll(async () => {
  ctx = await createTestContext();
  // Script appliqué comme en exploitation (idempotent)
  const mod = await import('../../../packages/database/scripts/service-roles.mjs');
  for (const stmt of splitSql(mod.serviceRolesSql())) await ctx.prisma.$executeRawUnsafe(stmt);
});
afterAll(async () => {
  await ctx.app.close();
});

/** Découpe le SQL généré en instructions (les blocs DO $$…$$ restent entiers). */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDo = false;
  for (const line of sql.split('\n')) {
    if (line.startsWith('--')) continue;
    buf += `${line}\n`;
    if (line.startsWith('DO $$')) inDo = true;
    if (inDo ? line.startsWith('END $$;') : line.trimEnd().endsWith(';')) {
      out.push(buf.trim());
      buf = '';
      inDo = false;
    }
  }
  return out;
}

describe('schémas par service', () => {
  it('chaque table est dans le schéma de son service ; public ne contient plus de table métier', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ table_schema: string; n: bigint }>>(
      `SELECT table_schema, count(*)::bigint AS n FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE'
       GROUP BY 1`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.table_schema, Number(r.n)]));
    expect(by).toMatchObject({
      platform: 5,
      auth: 8,
      members: 2,
      kyc: 8,
      compliance: 5,
      tontines: 8,
      wallets: 4,
      transactions: 3,
      payments: 4,
      notifications: 3,
      administration: 1,
      payment_gateway: 1,
    });
    // seule la table de suivi des migrations reste dans public
    expect(by['public'] ?? 0).toBeLessThanOrEqual(1);
  });

  it('aucun type énuméré partagé entre deux schémas de service', async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<Array<{ owner: string; used: string }>>(
      `SELECT DISTINCT tn.nspname AS owner, cn.nspname AS used
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
       JOIN pg_namespace cn ON cn.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid AND t.typtype = 'e'
       JOIN pg_namespace tn ON tn.oid = t.typnamespace
       WHERE tn.nspname <> cn.nspname`,
    );
    expect(rows).toEqual([]);
  });
});

describe('rôles PostgreSQL au moindre privilège', () => {
  it('un service lit et écrit son propre schéma', async () => {
    expect(await can('tm_members', 'SELECT 1 FROM members.mbr_members LIMIT 1')).toBe(true);
    expect(
      await can(
        'tm_notifications',
        `UPDATE notifications.ntf_notifications SET "readAt" = now() WHERE false`,
      ),
    ).toBe(true);
    expect(
      await can('tm_payment_gateway', 'SELECT 1 FROM payment_gateway.pgw_webhook_receipts'),
    ).toBe(true);
  });

  it('aucun accès aux tables d’un autre service hors liste déclarée', async () => {
    expect(await can('tm_members', 'SELECT 1 FROM auth.auth_users')).toBe(false);
    expect(await can('tm_notifications', 'SELECT 1 FROM members.mbr_members')).toBe(false);
    expect(await can('tm_kyc', 'SELECT 1 FROM members.mbr_members')).toBe(false);
    expect(await can('tm_auth', 'SELECT 1 FROM members.mbr_members')).toBe(false);
    expect(await can('tm_payment_gateway', 'SELECT 1 FROM payments.pay_payments')).toBe(false);
    expect(await can('tm_payment_gateway', 'SELECT 1 FROM platform.outbox_events')).toBe(false);
    expect(await can('tm_administration', 'SELECT 1 FROM auth.auth_users')).toBe(false);
    expect(await can('tm_administration', 'SELECT 1 FROM kyc.kyc_documents')).toBe(false);
  });

  it('lectures inter-schémas déclarées : lecture seule, jamais d’écriture', async () => {
    expect(await can('tm_members', 'SELECT 1 FROM tontines.ton_members LIMIT 1')).toBe(true);
    expect(
      await can('tm_members', `UPDATE tontines.ton_members SET "role" = 'MEMBER' WHERE false`),
    ).toBe(false);
    expect(await can('tm_compliance', 'SELECT 1 FROM wallets.wal_wallets LIMIT 1')).toBe(true);
    expect(
      await can('tm_compliance', `UPDATE wallets.wal_wallets SET "balanceMinor" = 0 WHERE false`),
    ).toBe(false);
    expect(await can('tm_administration', 'SELECT 1 FROM wallets.wal_movements LIMIT 1')).toBe(
      true,
    );
  });

  it('journal d’audit partagé : ajout autorisé, modification interdite', async () => {
    const insert = `INSERT INTO platform.audit_logs (id, action, "resourceType", result, "actorRole")
                    VALUES (gen_random_uuid(), 'test', 'test', 'SUCCESS', 'SYSTEM')`;
    expect(await can('tm_members', insert)).toBe(true);
    expect(await can('tm_members', `UPDATE platform.audit_logs SET action = 'x' WHERE false`)).toBe(
      false,
    );
    expect(await can('tm_members', `DELETE FROM platform.audit_logs WHERE false`)).toBe(false);
  });
});
