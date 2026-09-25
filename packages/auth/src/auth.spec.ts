import { describe, expect, it } from 'vitest';
import {
  DataCipher,
  JwtKeyStore,
  TokenVerificationError,
  can,
  generateNumericOtp,
  generateRecoveryCodes,
  generateRsaKeyMaterial,
  generateTotp,
  generateTotpSecret,
  hashSecret,
  normalizeRecoveryCode,
  resolveBcryptCost,
  sha256Hex,
  verifySecret,
  verifyTotp,
} from './index';

describe('hachage', () => {
  it('bcrypt : vérifie le bon secret uniquement', async () => {
    const h = await hashSecret('Secret#2026-Tontine', 4);
    expect(await verifySecret('Secret#2026-Tontine', h)).toBe(true);
    expect(await verifySecret('autre', h)).toBe(false);
    expect(await verifySecret('x', null)).toBe(false);
  });

  it('impose un coût ≥ 12 hors tests (R-AUTH-02)', () => {
    expect(resolveBcryptCost(10, 'production')).toBe(12);
    expect(resolveBcryptCost(4, 'test')).toBe(4);
  });

  it('SHA-256 déterministe', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('OTP à 6 chiffres', () => {
    for (let i = 0; i < 50; i++) expect(generateNumericOtp()).toMatch(/^\d{6}$/);
  });

  it('10 codes de récupération uniques XXXX-XXXX', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeRecoveryCode('abcd efgh')).toBe('ABCD-EFGH');
  });
});

describe('TOTP (RFC 6238)', () => {
  it('valide le code courant et la fenêtre ±30 s, refuse au-delà', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-09-24T12:00:00Z');
    const code = generateTotp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code, new Date(now.getTime() + 30_000))).toBe(true);
    expect(verifyTotp(secret, code, new Date(now.getTime() + 120_000))).toBe(false);
    expect(verifyTotp(secret, '12345', now)).toBe(false);
  });
});

describe('AES-256-GCM', () => {
  const cipher = new DataCipher(Buffer.alloc(32, 7).toString('base64'));
  it('chiffre et déchiffre', () => {
    const enc = cipher.encryptString('secret', 'aad');
    expect(enc).not.toContain('secret');
    expect(cipher.decryptString(enc, 'aad')).toBe('secret');
  });
  it('détecte une altération ou un AAD différent', () => {
    const enc = cipher.encrypt(Buffer.from('doc'), 'a');
    expect(() => cipher.decrypt(enc, 'b')).toThrow();
    enc.writeUInt8(enc.readUInt8(enc.length - 1) ^ 1, enc.length - 1);
    expect(() => cipher.decrypt(enc, 'a')).toThrow();
  });
  it('refuse une clé de mauvaise taille', () => {
    expect(() => new DataCipher('YQ==')).toThrow();
  });
});

describe('JWT RS256', () => {
  it('signe et vérifie avec rotation de clés', async () => {
    const oldKey = await generateRsaKeyMaterial('k1');
    const newKey = await generateRsaKeyMaterial('k2');
    const oldStore = await JwtKeyStore.create(oldKey);
    const store = await JwtKeyStore.create(newKey, [oldKey]);
    const legacy = await oldStore.sign({ sub: 'u1', role: 'MEMBER', tontineIds: ['t1'], sid: 's1' }, 900);
    const claims = await store.verify(legacy.token);
    expect(claims).toMatchObject({ sub: 'u1', role: 'MEMBER', tontineIds: ['t1'], sid: 's1' });
    expect(store.publicJwks.keys.map((k) => k.kid)).toEqual(['k2', 'k1']);
  });

  it('rejette un jeton expiré ou forgé', async () => {
    const store = await JwtKeyStore.create(await generateRsaKeyMaterial('k'));
    const now = new Date('2026-01-01T00:00:00Z');
    const t = await store.sign({ sub: 'u', role: 'MEMBER', tontineIds: [], sid: 's' }, 900, now);
    await expect(store.verify(t.token, new Date(now.getTime() + 901_000))).rejects.toMatchObject({ expired: true });
    const other = await JwtKeyStore.create(await generateRsaKeyMaterial('k'));
    await expect(other.verify(t.token, now)).rejects.toBeInstanceOf(TokenVerificationError);
  });
});

describe('RBAC', () => {
  it('KYC_AGENT ne peut pas créer de tontine ; SUPER_ADMIN peut tout', () => {
    expect(can('KYC_AGENT', 'tontine.create')).toBe(false);
    expect(can('KYC_AGENT', 'kyc.review')).toBe(true);
    expect(can('MEMBER', 'platform.jobs.run')).toBe(false);
    expect(can('SUPER_ADMIN', 'platform.jobs.run')).toBe(true);
  });
});
