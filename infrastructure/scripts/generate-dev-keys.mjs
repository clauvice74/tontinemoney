#!/usr/bin/env node
/**
 * Génère les clés de DÉVELOPPEMENT (jamais pour la production) :
 *  - paire RSA 2048 pour les JWT RS256 dans `.keys/` (ignoré par git, A-26) ;
 *  - affiche une clé de chiffrement DATA_ENCRYPTION_KEY aléatoire (base64, 32 octets).
 * Usage : pnpm keys:generate [--force]
 */
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.cwd(), process.env.JWT_KEYS_DIR ?? '.keys');
const force = process.argv.includes('--force');
const priv = join(dir, 'jwt-private.pem');

if (existsSync(priv) && !force) {
  console.log(`Clés déjà présentes dans ${dir} (utilisez --force pour régénérer).`);
} else {
  mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  writeFileSync(priv, privateKey, { mode: 0o600 });
  writeFileSync(join(dir, 'jwt-public.pem'), publicKey);
  writeFileSync(join(dir, 'jwt-kid.txt'), `dev-${randomUUID().slice(0, 8)}`);
  console.log(`✔ Paire de clés JWT de développement écrite dans ${dir}`);
}
console.log(`DATA_ENCRYPTION_KEY suggérée (développement) : ${randomBytes(32).toString('base64')}`);
