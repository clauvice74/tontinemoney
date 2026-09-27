import 'reflect-metadata';

async function main(): Promise<void> {
  const { loadConfig } = await import('@tontine/config');
  const { createReportingService } = await import('./bootstrap');
  const config = loadConfig();
  if (!config.EXTRACTED_SERVICES.includes('reporting')) {
    // Monolithe seul : le reporting est servi par apps/api
    process.stdout.write(
      `${JSON.stringify({ level: 'info', service: 'reporting', msg: 'non extrait (EXTRACTED_SERVICES) : inactif' })}\n`,
    );
    return;
  }
  const app = await createReportingService({ config });
  await app.listen(config.REPORTING_SERVICE_PORT);
  process.stdout.write(
    `${JSON.stringify({ level: 'info', service: config.SERVICE_NAME, msg: 'reporting-service prêt', port: config.REPORTING_SERVICE_PORT, ports: config.PORTS_UPSTREAM_URL })}\n`,
  );
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
