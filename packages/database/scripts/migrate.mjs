#!/usr/bin/env node
// Outil de migration sans binaire natif :
//  - `deploy` applique chaque migration.sql dans une transaction via `pg`, et tient à jour
//    la table `_prisma_migrations` au format Prisma (checksum SHA-256) : `prisma migrate deploy`
//    reste utilisable sur la même base ;
//  - `new` / `diff` s'appuient sur le schema engine officiel de Prisma compilé en WebAssembly
//    (@prisma/schema-engine-wasm) pour calculer le SQL à partir de schema.prisma.
//
// Usage :
//   node scripts/migrate.mjs deploy [--test]   applique les migrations en attente
//   node scripts/migrate.mjs status [--test]   liste les migrations appliquées / en attente
//   node scripts/migrate.mjs new <nom>         génère une migration (schema.prisma vs dernier instantané)
//   node scripts/migrate.mjs diff              affiche le SQL restant à générer (0 = à jour)
//   node scripts/migrate.mjs reset [--test]    supprime le schéma public et réapplique (hors production)

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (!String(w.message).includes('WebAssembly')) console.warn(w);
});

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const migrationsDir = join(root, 'prisma', 'migrations');
const schemaPath = join(root, 'prisma', 'schema.prisma');
const filters = { externalTables: [], externalEnums: [] };

const [, , command, ...args] = process.argv;
const useTest = args.includes('--test');
const url = useTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!url) fail(`${useTest ? 'DATABASE_URL_TEST' : 'DATABASE_URL'} n'est pas défini`);

function loadMigrationsList() {
  if (!existsSync(migrationsDir)) mkdirSync(migrationsDir, { recursive: true });
  const lockPath = join(migrationsDir, 'migration_lock.toml');
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return {
    baseDir: migrationsDir,
    lockfile: {
      path: 'migration_lock.toml',
      content: existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null,
    },
    shadowDbInitScript: '',
    migrationDirectories: dirs.map((name) => {
      const file = join(migrationsDir, name, 'migration.sql');
      return {
        path: name,
        migrationFile: {
          path: 'migration.sql',
          content: existsSync(file)
            ? { tag: 'ok', value: readFileSync(file, 'utf8') }
            : { tag: 'error', value: 'migration.sql introuvable' },
        },
      };
    }),
  };
}

async function engine() {
  const [{ SchemaEngine }, { PrismaPg }, { bindMigrationAwareSqlAdapterFactory }] =
    await Promise.all([
      import('@prisma/schema-engine-wasm'),
      import('@prisma/adapter-pg'),
      import('@prisma/driver-adapter-utils'),
    ]);
  const schema = readFileSync(schemaPath, 'utf8');
  // L'adaptateur découpe les scripts sur « ; » : on exécute plutôt le script d'un bloc
  // (fonctions plpgsql, commentaires contenant des points-virgules).
  // Configuration décomposée : avec `connectionString`, la base fantôme hériterait de la base principale.
  const u = new URL(url);
  const base = new PrismaPg({
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
  });
  const patch = (adapter) => {
    adapter.executeScript = async (script) => {
      try {
        await adapter.underlyingDriver().query(script);
      } catch (e) {
        if (process.env.MIGRATE_DEBUG) console.error('executeScript:', e?.message ?? e);
        throw e;
      }
    };
    return adapter;
  };
  const factory = bindMigrationAwareSqlAdapterFactory({
    provider: base.provider,
    adapterName: base.adapterName,
    connect: async () => patch(await base.connect()),
    connectToShadowDb: async () => {
      const shadow = patch(await base.connectToShadowDb());
      // Libère la connexion avant de supprimer la base fantôme.
      shadow.dispose = async () => {
        const pool = shadow.underlyingDriver();
        const name = pool.options.database;
        await pool.end();
        const admin = new pg.Client({ connectionString: url });
        await admin.connect();
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin.end();
      };
      return shadow;
    },
  });
  const logs = [];
  const instance = await SchemaEngine.new(
    { datamodels: [['schema.prisma', schema]] },
    (log) => logs.push(log),
    factory,
  );
  return { instance, schema };
}

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

async function deploy() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(72707369)');
    await client.query(MIGRATIONS_TABLE);
    const { rows } = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at);
    if (failed.length) {
      fail(
        `Migration(s) en échec à résoudre avant de continuer : ${failed.map((r) => r.migration_name).join(', ')}`,
      );
    }
    const applied = new Map(
      rows.filter((r) => r.finished_at).map((r) => [r.migration_name, r.checksum]),
    );
    let count = 0;
    for (const dir of loadMigrationsList().migrationDirectories) {
      if (dir.migrationFile.content.tag !== 'ok')
        fail(`${dir.path} : ${dir.migrationFile.content.value}`);
      const script = dir.migrationFile.content.value;
      const checksum = createHash('sha256').update(script).digest('hex');
      if (applied.has(dir.path)) {
        if (applied.get(dir.path) !== checksum) {
          console.warn(
            `⚠ La migration ${dir.path} a été modifiée après application (checksum différent)`,
          );
        }
        continue;
      }
      const id = randomUUID();
      await client.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES ($1, $2, $3, now(), 0)',
        [id, checksum, dir.path],
      );
      try {
        await client.query('BEGIN');
        await client.query(script);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        await client.query('UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1', [
          id,
          String(e?.message ?? e),
        ]);
        fail(`Échec de ${dir.path} : ${e?.message ?? e}`);
      }
      await client.query(
        'UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1',
        [id],
      );
      console.log(`✔ Migration appliquée : ${dir.path}`);
      count++;
    }
    if (count === 0) console.log('✔ Base à jour, aucune migration en attente');
  } finally {
    await client.query('SELECT pg_advisory_unlock(72707369)').catch(() => undefined);
    await client.end();
  }
}

async function status() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let applied = [];
  try {
    const r = await client.query(
      'SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at',
    );
    applied = r.rows;
  } catch {
    applied = [];
  } finally {
    await client.end();
  }
  const names = new Set(applied.map((r) => r.migration_name));
  const all = loadMigrationsList().migrationDirectories.map((d) => d.path);
  for (const name of all)
    console.log(`${names.has(name) ? '✔ appliquée ' : '… en attente'}  ${name}`);
  const pending = all.filter((n) => !names.has(n));
  process.exitCode = pending.length ? 2 : 0;
}

/**
 * Chaque migration conserve un instantané `schema.prisma` : le SQL d'une nouvelle migration est
 * calculé par différence entre deux datamodels (aucune base fantôme nécessaire).
 */
function latestSnapshot() {
  const dirs = loadMigrationsList()
    .migrationDirectories.map((d) => d.path)
    .reverse();
  for (const d of dirs) {
    const snap = join(migrationsDir, d, 'schema.prisma');
    if (existsSync(snap)) return readFileSync(snap, 'utf8');
  }
  return null;
}

async function diffSql() {
  const { instance, schema } = await engine();
  const snapshot = latestSnapshot();
  const from = snapshot
    ? { tag: 'schemaDatamodel', files: [{ path: 'schema.prisma', content: snapshot }] }
    : { tag: 'empty' };
  const res = await instance.diff({
    from,
    to: { tag: 'schemaDatamodel', files: [{ path: 'schema.prisma', content: schema }] },
    script: true,
    exitCode: null,
    filters,
  });
  const sql = (res.stdout ?? '').trim();
  return sql === '-- This is an empty migration.' ? '' : sql;
}

async function newMigration(name) {
  if (!name || !/^[a-z0-9_]+$/.test(name)) fail('Nom de migration requis (snake_case)');
  const sql = await diffSql();
  if (!sql) {
    console.log('✔ Aucun changement de schéma détecté');
    return;
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const dir = join(migrationsDir, `${stamp}_${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'migration.sql'), `${sql}\n`);
  writeFileSync(join(dir, 'schema.prisma'), readFileSync(schemaPath, 'utf8'));
  const lock = join(migrationsDir, 'migration_lock.toml');
  if (!existsSync(lock)) writeFileSync(lock, 'provider = "postgresql"\n');
  console.log(`✔ Migration créée : ${dir}`);
}

async function reset() {
  if (process.env.NODE_ENV === 'production') fail('reset interdit en production');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  console.log('✔ Schéma public réinitialisé');
  await deploy();
}

try {
  switch (command) {
    case 'deploy':
      await deploy();
      break;
    case 'status':
      await status();
      break;
    case 'new':
      await newMigration(args.find((a) => !a.startsWith('--')));
      break;
    case 'diff': {
      const sql = await diffSql();
      if (sql) {
        console.log(sql);
        process.exitCode = 2;
      } else console.log('✔ Migrations et schema.prisma sont synchronisés');
      break;
    }
    case 'reset':
      await reset();
      break;
    default:
      fail('Commande inconnue (deploy | status | new <nom> | diff | reset)');
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
process.exit(process.exitCode ?? 0);
