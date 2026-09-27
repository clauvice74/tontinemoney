#!/usr/bin/env node
// Contrôle d'architecture « aucun service ne lit les tables d'un autre service » (extraction,
// étape 4). Analyse statique du code de chaque service :
//   - accès Prisma `prisma|tx|db|client.<modèle>.<opération>` ;
//   - tables citées dans le SQL brut (`"prefixe_table"`).
// Chaque accès à un schéma autre que celui du service (hors `platform`) doit figurer dans
// infrastructure/data-ownership.allowlist.json avec sa justification et l'étape qui le supprime.
// Échec : accès non déclaré, ou entrée de la liste devenue inutile (la liste reste exacte).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schema = readFileSync(join(root, 'packages/database/prisma/schema.prisma'), 'utf8');
const allowlist = JSON.parse(
  readFileSync(join(root, 'infrastructure/data-ownership.allowlist.json'), 'utf8'),
);

/** Service → schéma propriétaire (le répertoire services/<service> porte le nom du schéma). */
const SERVICES = [
  'auth',
  'members',
  'kyc',
  'compliance',
  'tontines',
  'wallets',
  'transactions',
  'payments',
  'notifications',
  'administration',
];
const SHARED = new Set(['platform']);

const modelSchema = new Map();
const tableSchema = new Map();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const table = /@@map\("([a-z_]+)"\)/.exec(m[2])?.[1];
  const sch = /@@schema\("([a-z_]+)"\)/.exec(m[2])?.[1];
  if (!table || !sch) throw new Error(`Modèle ${m[1]} sans @@map ou @@schema`);
  modelSchema.set(m[1][0].toLowerCase() + m[1].slice(1), sch);
  tableSchema.set(table, sch);
}

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const OPS =
  'findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany';
const READ = /^(find|count|aggregate|groupBy)/;
const found = new Map(); // clé → { entry, files }

for (const service of SERVICES) {
  for (const file of files(join(root, 'services', service, 'src'))) {
    const code = readFileSync(file, 'utf8');
    const rel = relative(root, file);
    const add = (sch, object, access) => {
      if (sch === service || SHARED.has(sch)) return;
      const key = `${service}|${sch}|${object}|${access}`;
      const f = found.get(key) ?? { service, schema: sch, object, access, files: new Set() };
      f.files.add(rel);
      found.set(key, f);
    };
    for (const m of code.matchAll(
      new RegExp(`\\b(?:prisma|tx|db|client)\\.(\\w+)\\.(${OPS})\\b`, 'g'),
    )) {
      const sch = modelSchema.get(m[1]);
      if (sch) add(sch, m[1], READ.test(m[2]) ? 'read' : 'write');
    }
    for (const m of code.matchAll(/"([a-z]+_[a-z_]+)"/g)) {
      const sch = tableSchema.get(m[1]);
      if (sch) add(sch, m[1], 'sql');
    }
  }
}

const allowed = new Map(
  allowlist.entries.map((e) => [`${e.service}|${e.schema}|${e.object}|${e.access}`, e]),
);
const violations = [...found.entries()].filter(([k]) => !allowed.has(k));
const stale = [...allowed.keys()].filter((k) => !found.has(k));

for (const e of allowlist.entries) {
  if (!e.reason || !e.removal)
    throw new Error(`Entrée sans justification ou étape de suppression : ${JSON.stringify(e)}`);
}

if (violations.length || stale.length) {
  for (const [, v] of violations)
    console.error(
      `✖ ${v.service} → ${v.schema}.${v.object} (${v.access}) non déclaré : ${[...v.files].join(', ')}`,
    );
  for (const k of stale)
    console.error(`✖ entrée devenue inutile, à retirer : ${k.replaceAll('|', ' ')}`);
  console.error(
    '\nPasser par un port, un événement ou une projection ; sinon, déclarer l’accès dans infrastructure/data-ownership.allowlist.json (justification + étape de suppression).',
  );
  process.exit(1);
}
const bySchema = new Set([...found.values()].map((f) => `${f.service}→${f.schema}`));
console.log(
  `✔ Propriété des données respectée : ${found.size} accès inter-schémas, tous déclarés (${bySchema.size} dépendances service→schéma)`,
);
