#!/usr/bin/env node
// Rôles PostgreSQL par service (extraction, étape 4) : moindre privilège, dérivé de
// schema.prisma (propriété des tables) et de infrastructure/data-ownership.allowlist.json
// (lectures inter-schémas tolérées). Rôles `tm_<schéma>` sans connexion (NOLOGIN) : les
// comptes de connexion de chaque service extrait en seront membres (étape 7).
//
//   node scripts/service-roles.mjs            applique sur DATABASE_URL
//   node scripts/service-roles.mjs --test     applique sur DATABASE_URL_TEST
//   node scripts/service-roles.mjs --print    affiche le SQL
//
// Idempotent : les droits sont révoqués puis réaccordés à chaque exécution. Nécessite un rôle
// disposant de CREATEROLE (superutilisateur en Docker / CI).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

/** Tables techniques partagées tant que les services ne sont pas séparés (une copie par service à l'étape 7). */
const PLATFORM_RW = ['outbox_events', 'processed_events', 'idempotency_keys', 'job_runs'];
const PLATFORM_APPEND = ['audit_logs'];
/** Services sans accès aux tables techniques partagées. */
const NO_PLATFORM = new Set(['payment_gateway']);

export function ownership() {
  const schema = readFileSync(join(root, 'packages/database/prisma/schema.prisma'), 'utf8');
  const schemas = /schemas\s*=\s*\[([^\]]*)\]/
    .exec(schema)[1]
    .match(/"([a-z_]+)"/g)
    .map((s) => s.slice(1, -1));
  const tables = new Map(); // table → schéma
  const models = new Map(); // modèle (camelCase) → table
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const table = /@@map\("([a-z_]+)"\)/.exec(m[2])[1];
    tables.set(table, /@@schema\("([a-z_]+)"\)/.exec(m[2])[1]);
    models.set(m[1][0].toLowerCase() + m[1].slice(1), table);
  }
  const allowlist = JSON.parse(
    readFileSync(join(root, 'infrastructure/data-ownership.allowlist.json'), 'utf8'),
  ).entries;
  return { schemas, tables, models, allowlist };
}

export const roleOf = (schemaName) => `tm_${schemaName}`;
const q = (id) => `"${id.replaceAll('"', '""')}"`;

/** SQL idempotent de création des rôles et des droits. */
export function serviceRolesSql() {
  const { schemas, tables, models, allowlist } = ownership();
  const services = schemas.filter((s) => s !== 'platform');
  const out = [
    '-- Généré par packages/database/scripts/service-roles.mjs — ne pas modifier à la main',
  ];
  for (const s of services) {
    const r = roleOf(s);
    out.push(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN
    CREATE ROLE ${q(r)} NOLOGIN;
  END IF;
END $$;`);
    // Remise à zéro : aucune trace d'un droit retiré de la liste
    for (const any of schemas) {
      out.push(`REVOKE ALL ON ALL TABLES IN SCHEMA ${q(any)} FROM ${q(r)};`);
      out.push(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${q(any)} FROM ${q(r)};`);
      out.push(`REVOKE ALL ON SCHEMA ${q(any)} FROM ${q(r)};`);
    }
    out.push(`GRANT USAGE ON SCHEMA public, ${q(s)} TO ${q(r)};`);
    out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${q(s)} TO ${q(r)};`);
    out.push(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${q(s)} TO ${q(r)};`);
    out.push(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${q(s)} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${q(r)};`,
    );
    if (!NO_PLATFORM.has(s)) {
      out.push(`GRANT USAGE ON SCHEMA platform TO ${q(r)};`);
      for (const t of PLATFORM_RW)
        out.push(`GRANT SELECT, INSERT, UPDATE ON platform.${q(t)} TO ${q(r)};`);
      for (const t of PLATFORM_APPEND)
        out.push(`GRANT SELECT, INSERT ON platform.${q(t)} TO ${q(r)};`);
    }
    // Lectures inter-schémas tolérées (liste documentée), en lecture seule
    const reads = new Set();
    for (const e of allowlist.filter((e) => e.service === s)) {
      const table = e.access === 'sql' ? e.object : models.get(e.object);
      if (!table || tables.get(table) !== e.schema)
        throw new Error(`Entrée de liste incohérente avec le schéma : ${JSON.stringify(e)}`);
      if (e.access === 'write')
        throw new Error(`Écriture inter-schémas interdite : ${e.service} → ${e.schema}.${table}`);
      reads.add(`${e.schema}.${table}`);
    }
    for (const t of [...reads].sort()) {
      const [sch, table] = t.split('.');
      out.push(`GRANT USAGE ON SCHEMA ${q(sch)} TO ${q(r)};`);
      out.push(`GRANT SELECT ON ${q(sch)}.${q(table)} TO ${q(r)};`);
    }
    // Le rôle qui applique ce script peut adopter le rôle (tests, administration)
    out.push(`GRANT ${q(r)} TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;`);
  }
  return out.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const sql = serviceRolesSql();
  if (args.includes('--print')) {
    process.stdout.write(`${sql}\n`);
    return;
  }
  const url = args.includes('--test') ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL / DATABASE_URL_TEST non défini');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
  const { schemas } = ownership();
  console.log(
    `✔ Rôles de service appliqués : ${schemas
      .filter((s) => s !== 'platform')
      .map(roleOf)
      .join(', ')}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
