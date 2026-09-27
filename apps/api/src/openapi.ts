import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Exporte le contrat OpenAPI dans docs/openapi.json (sans démarrer le serveur HTTP). */
async function main(): Promise<void> {
  const { loadConfig } = await import('@tontine/config');
  const { createApp, buildOpenApi } = await import('./bootstrap');
  const config = loadConfig({
    ...process.env,
    SCHEDULER_ENABLED: 'false',
    KV_DRIVER: 'memory',
    EMAIL_DRIVER: 'memory',
  });
  const app = await createApp({ config });
  await app.init();
  const doc = buildOpenApi(app);
  const out = resolve(__dirname, '../../../docs/openapi.json');
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  await app.close();
  console.warn(`OpenAPI écrit dans ${out} (${Object.keys(doc.paths).length} chemins)`);
}

void main();
