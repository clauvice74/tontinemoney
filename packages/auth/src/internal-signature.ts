import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Authentification des appels internes de service à service (ex. Payment Gateway → Payment
 * Service) : HMAC-SHA256(secret, `${appelant}.${horodatage}.${corps}`), horodatage borné
 * (anti-rejeu). Ces routes ne sont jamais exposées par l'API Gateway.
 */
export const INTERNAL_CALLER_HEADER = 'x-internal-caller';
export const INTERNAL_TIMESTAMP_HEADER = 'x-internal-timestamp';
export const INTERNAL_SIGNATURE_HEADER = 'x-internal-signature';

function mac(secret: string, caller: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${caller}.${timestamp}.${body}`).digest('hex');
}

export function signInternalRequest(
  secret: string,
  caller: string,
  body: string,
  now: Date = new Date(),
): Record<string, string> {
  const ts = Math.floor(now.getTime() / 1000);
  return {
    [INTERNAL_CALLER_HEADER]: caller,
    [INTERNAL_TIMESTAMP_HEADER]: String(ts),
    [INTERNAL_SIGNATURE_HEADER]: mac(secret, caller, ts, body),
  };
}

export type InternalVerification =
  | { ok: true; caller: string }
  | { ok: false; reason: 'MISSING' | 'CALLER' | 'TIMESTAMP' | 'SIGNATURE' };

export function verifyInternalRequest(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  body: string,
  options: { allowedCallers: readonly string[]; toleranceSeconds?: number; now?: Date },
): InternalVerification {
  const one = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const caller = one(INTERNAL_CALLER_HEADER);
  const tsRaw = one(INTERNAL_TIMESTAMP_HEADER);
  const sig = one(INTERNAL_SIGNATURE_HEADER);
  if (!caller || !tsRaw || !sig) return { ok: false, reason: 'MISSING' };
  if (!options.allowedCallers.includes(caller)) return { ok: false, reason: 'CALLER' };
  if (!/^\d{9,12}$/.test(tsRaw) || !/^[0-9a-f]{64}$/.test(sig))
    return { ok: false, reason: 'SIGNATURE' };
  const ts = Number(tsRaw);
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - ts) > (options.toleranceSeconds ?? 60))
    return { ok: false, reason: 'TIMESTAMP' };
  const expected = Buffer.from(mac(secret, caller, ts, body), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(sig, 'hex')))
    return { ok: false, reason: 'SIGNATURE' };
  return { ok: true, caller };
}
