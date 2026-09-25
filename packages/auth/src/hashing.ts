import { hash, verify } from '@node-rs/bcrypt';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

/** Coût bcrypt minimal en production (R-AUTH-02). Les tests peuvent abaisser via `allowLowCost`. */
export const MIN_BCRYPT_COST = 12;

export function resolveBcryptCost(requested: number, env: string): number {
  if (env === 'test') return Math.max(4, requested);
  return Math.max(MIN_BCRYPT_COST, requested);
}

export async function hashSecret(secret: string, cost: number): Promise<string> {
  return hash(secret, cost);
}

export async function verifySecret(secret: string, digest: string | null | undefined): Promise<boolean> {
  if (!digest) {
    // Temps constant approximatif même sans empreinte (anti-énumération).
    await hash(secret, 4);
    return false;
  }
  try {
    return await verify(secret, digest);
  } catch {
    return false;
  }
}

/** Jeton opaque UUID v4 (liens d'activation, reset, refresh token). */
export function generateOpaqueToken(): string {
  return randomUUID();
}

/** Empreinte SHA-256 hexadécimale (stockage des jetons, US-1.1 / US-1.5). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** OTP numérique à 6 chiffres (US-1.2) — `crypto.randomInt`, pas de caractère ambigu. */
export function generateNumericOtp(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Codes de récupération MFA `XXXX-XXXX` alphanumériques (US-1.6). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    for (let i = 0; i < 8; i++) raw += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}

export function normalizeRecoveryCode(code: string): string {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : code.toUpperCase();
}
