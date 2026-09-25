import * as OTPAuth from 'otpauth';

/** TOTP RFC 6238 : SHA-1, 6 chiffres, période 30 s, secret 160 bits (US-1.6). */
export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function totpFor(secretBase32: string, label = 'TontineMoney', issuer = 'TontineMoney'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function totpUri(secretBase32: string, accountLabel: string): string {
  return totpFor(secretBase32, accountLabel).toString();
}

export function generateTotp(secretBase32: string, at: Date = new Date()): string {
  return totpFor(secretBase32).generate({ timestamp: at.getTime() });
}

/** Vérifie un code avec une tolérance d'une période (±30 s). */
export function verifyTotp(secretBase32: string, code: string, at: Date = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return totpFor(secretBase32).validate({ token: code, timestamp: at.getTime(), window: 1 }) !== null;
}
