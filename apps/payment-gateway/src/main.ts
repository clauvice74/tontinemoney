import 'reflect-metadata';
import { createPaymentGateway } from './bootstrap';
import { loadPaymentGatewayConfig } from './config';

async function main(): Promise<void> {
  const config = loadPaymentGatewayConfig(process.env);
  const app = await createPaymentGateway({ config });
  await app.listen(config.PAYMENT_GATEWAY_PORT);
  process.stdout.write(
    `${JSON.stringify({ level: 'info', service: 'payment-gateway', msg: 'Payment Gateway démarré', port: config.PAYMENT_GATEWAY_PORT, providers: config.PAYMENT_GATEWAY_PROVIDERS })}\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
