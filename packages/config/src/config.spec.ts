import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig, testConfig } from './index';

describe('config', () => {
  it('charge une configuration de test valide', () => {
    const c = testConfig();
    expect(c.NODE_ENV).toBe('test');
    expect(c.KV_DRIVER).toBe('memory');
  });

  it('refuse une configuration de production non sécurisée', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://x',
        DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
        PSP_WEBHOOK_SECRET: 'dev-only-webhook-secret-change-me',
      }),
    ).toThrow(ConfigValidationError);
  });
});
