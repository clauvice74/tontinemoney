import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadPaymentGatewayConfig } from './config';
import { FlutterwaveVerifier, PaystackVerifier, WebhookRejected, majorToMinor } from './verifiers';

describe('configuration', () => {
  const DB = 'postgresql://tontine:tontine@localhost:5432/tontinemoney_test';
  it('production : secrets de dev et intégrations réelles refusés', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: DB,
      INTERNAL_SERVICE_SECRET: 'dev-only-internal-service-secret-change-me',
      PSP_WEBHOOK_SECRET: 'dev-only-webhook-secret-change-me',
    };
    expect(() => loadPaymentGatewayConfig(base)).toThrow(/INTERNAL_SERVICE_SECRET/);
    expect(() =>
      loadPaymentGatewayConfig({
        ...base,
        INTERNAL_SERVICE_SECRET: 'x'.repeat(40),
        PSP_WEBHOOK_SECRET: 'y'.repeat(40),
        PAYMENT_GATEWAY_PROVIDERS: '["flutterwave"]',
      }),
    ).toThrow(/flutterwave/);
  });
});

describe('intégrations préparées (désactivées)', () => {
  it('conversion exacte unités majeures → mineures selon la devise, sans flottant', () => {
    expect(majorToMinor(1500.5, 'NGN')).toBe('150050');
    expect(majorToMinor(0.1, 'GHS')).toBe('10');
    expect(majorToMinor(25000, 'XAF')).toBe('25000');
    expect(() => majorToMinor(12.345, 'NGN')).toThrow(WebhookRejected);
    expect(() => majorToMinor(10.5, 'XAF')).toThrow(WebhookRejected);
    expect(() => majorToMinor(-1, 'NGN')).toThrow(WebhookRejected);
  });

  it('Flutterwave : verif-hash obligatoire ; Paystack : HMAC-SHA512', () => {
    const ref = randomUUID();
    const fw = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: {
          id: 42,
          tx_ref: ref,
          flw_ref: 'FLW-1',
          amount: 1500.5,
          currency: 'NGN',
          status: 'successful',
          created_at: '2026-09-27T10:00:00.000Z',
        },
      }),
    );
    const f = new FlutterwaveVerifier('hash-secret');
    expect(() => f.verify({ 'verif-hash': 'wrong' }, fw)).toThrow(WebhookRejected);
    expect(() => new FlutterwaveVerifier('').verify({ 'verif-hash': '' }, fw)).toThrow(
      WebhookRejected,
    );
    expect(f.verify({ 'verif-hash': 'hash-secret' }, fw)).toMatchObject({
      merchantReference: ref,
      amountMinor: '150050',
      currency: 'NGN',
      status: 'SUCCESS',
    });
    const ps = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { id: 7, reference: ref, status: 'success', amount: 500000, currency: 'NGN' },
      }),
    );
    const sig = createHmac('sha512', 'sk_test').update(ps).digest('hex');
    const p = new PaystackVerifier('sk_test');
    expect(p.verify({ 'x-paystack-signature': sig }, ps)).toMatchObject({
      amountMinor: '500000',
      status: 'SUCCESS',
    });
    expect(() => p.verify({ 'x-paystack-signature': 'a'.repeat(128) }, ps)).toThrow(
      WebhookRejected,
    );
  });
});
