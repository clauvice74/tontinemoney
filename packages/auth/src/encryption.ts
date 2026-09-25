import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement applicatif AES-256-GCM (R-KYC-05, secret TOTP).
 * Format binaire : version(1) | iv(12) | tag(16) | données.
 */
const VERSION = 1;

export class DataCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY doit faire 32 octets (base64)');
    this.key = key;
  }

  encrypt(plain: Buffer, aad?: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]);
  }

  decrypt(payload: Buffer, aad?: string): Buffer {
    if (payload.length < 29 || payload[0] !== VERSION) throw new Error('Format chiffré invalide');
    const iv = payload.subarray(1, 13);
    const tag = payload.subarray(13, 29);
    const data = payload.subarray(29);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  encryptString(plain: string, aad?: string): string {
    return this.encrypt(Buffer.from(plain, 'utf8'), aad).toString('base64');
  }

  decryptString(payload: string, aad?: string): string {
    return this.decrypt(Buffer.from(payload, 'base64'), aad).toString('utf8');
  }
}
