// Génère le client Prisma 7 (générateur « prisma-client », sans moteur natif).
// La génération n'utilise pas le schema engine : on neutralise son téléchargement
// pour permettre les builds hors ligne / derrière un proxy restrictif.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env };
if (!env.PRISMA_SCHEMA_ENGINE_BINARY) {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-noengine-'));
  const stub = join(dir, 'schema-engine');
  writeFileSync(stub, '#!/bin/sh\necho "schema engine not used by generate" >&2\nexit 1\n');
  chmodSync(stub, 0o755);
  env.PRISMA_SCHEMA_ENGINE_BINARY = stub;
}
const res = spawnSync('prisma', ['generate'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
if (res.status !== 0) process.exit(res.status ?? 1);

// Le client généré est versionné : on le formate comme le reste du dépôt, sinon chaque build
// le modifie et fait échouer `pnpm format:check`. Prettier absent (installation sans
// dépendances de dev) : on laisse le client tel quel.
const fmt = spawnSync('prettier', ['--write', '--log-level', 'warn', 'src/generated'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (fmt.error && fmt.error.code !== 'ENOENT')
  console.warn(`Formatage ignoré : ${fmt.error.message}`);
process.exit(0);
