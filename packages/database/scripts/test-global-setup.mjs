// Prépare la base de test avant les tests d'intégration : applique les migrations en attente.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function setup() {
  const url = process.env.DATABASE_URL_TEST ?? 'postgresql://tontine:tontine@localhost:5432/tontinemoney_test';
  process.env.DATABASE_URL_TEST = url;
  const script = join(dirname(fileURLToPath(import.meta.url)), 'migrate.mjs');
  const res = spawnSync(process.execPath, [script, 'deploy', '--test'], {
    env: { ...process.env, DATABASE_URL_TEST: url },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`Migration de la base de test impossible (${url}) :\n${res.stderr || res.stdout}`);
  }
}
