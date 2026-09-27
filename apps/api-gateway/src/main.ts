import 'reflect-metadata';
import { createGateway } from './bootstrap';
import { loadGatewayConfig } from './config';

async function main(): Promise<void> {
  const config = loadGatewayConfig(process.env);
  const app = await createGateway({ config });
  await app.listen(config.GATEWAY_PORT);
  process.stdout.write(
    `${JSON.stringify({ level: 'info', service: 'api-gateway', msg: 'Gateway démarré', port: config.GATEWAY_PORT, upstream: config.API_UPSTREAM_URL })}\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
