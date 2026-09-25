import 'reflect-metadata';
import { startTelemetry } from './telemetry';

// OpenTelemetry doit être initialisé avant le chargement des modules instrumentés.
const telemetry = startTelemetry();

async function main(): Promise<void> {
  const { loadConfig } = await import('@tontine/config');
  const { createApp } = await import('./bootstrap');
  const config = loadConfig();
  const app = await createApp({ config });
  await app.listen(config.API_PORT);
  // eslint-disable-next-line no-console
  console.log(`TontineMoney API prête sur ${config.API_PUBLIC_URL} (Swagger : /api/docs)`);
  const shutdown = async () => {
    await app.close();
    await telemetry?.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
