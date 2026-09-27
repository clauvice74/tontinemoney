import { Logger, type Provider } from '@nestjs/common';
import { JwtKeyStore, generateRsaKeyMaterial } from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { APP_CONFIG } from '@tontine/platform';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const JWT_KEYSTORE = Symbol('JWT_KEYSTORE');

/**
 * Clés RS256 (A-26) : fournies par l'environnement (production), sinon générées et persistées
 * dans `.keys/` (développement) ou éphémères (tests).
 */
export const jwtKeyStoreProvider: Provider = {
  provide: JWT_KEYSTORE,
  inject: [APP_CONFIG],
  useFactory: async (config: AppConfig): Promise<JwtKeyStore> => {
    const logger = new Logger('JwtKeys');
    if (config.JWT_PRIVATE_KEY_PEM && config.JWT_PUBLIC_KEY_PEM) {
      return JwtKeyStore.create(
        {
          kid: config.JWT_KEY_ID || 'env-key',
          privateKeyPem: config.JWT_PRIVATE_KEY_PEM.replace(/\\n/g, '\n'),
          publicKeyPem: config.JWT_PUBLIC_KEY_PEM.replace(/\\n/g, '\n'),
        },
        [],
        config.JWT_ISSUER,
      );
    }
    if (config.NODE_ENV === 'test') {
      return JwtKeyStore.create(await generateRsaKeyMaterial('test-key'), [], config.JWT_ISSUER);
    }
    const dir = resolve(config.JWT_KEYS_DIR);
    const priv = join(dir, 'jwt-private.pem');
    const pub = join(dir, 'jwt-public.pem');
    const kidFile = join(dir, 'jwt-kid.txt');
    if (!existsSync(priv) || !existsSync(pub)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const km = await generateRsaKeyMaterial(`dev-${new Date().toISOString().slice(0, 10)}`);
      writeFileSync(priv, km.privateKeyPem, { mode: 0o600 });
      writeFileSync(pub, km.publicKeyPem);
      writeFileSync(kidFile, km.kid);
      logger.warn(`Paire de clés JWT de développement générée dans ${dir}`);
    }
    return JwtKeyStore.create(
      {
        kid: existsSync(kidFile) ? readFileSync(kidFile, 'utf8').trim() : 'dev',
        privateKeyPem: readFileSync(priv, 'utf8'),
        publicKeyPem: readFileSync(pub, 'utf8'),
      },
      [],
      config.JWT_ISSUER,
    );
  },
};
