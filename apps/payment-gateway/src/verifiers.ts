import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  type PaymentNotification,
  MoneyError,
  paymentNotificationSchema,
  toMinor,
} from '@tontine/contracts';
import { z } from 'zod';

export type RejectionReason = 'SIGNATURE' | 'TIMESTAMP' | 'PAYLOAD' | 'PROVIDER';

export class WebhookRejected extends Error {
  constructor(readonly reason: RejectionReason) {
    super(`Webhook refusé (${reason})`);
    this.name = 'WebhookRejected';
  }
}

type Headers = Record<string, string | string[] | undefined>;
const header = (h: Headers, k: string) => {
  const v = h[k];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Vérification et normalisation d'un webhook d'un prestataire. Toute notification produite est
 * validée par `paymentNotificationSchema` : montant entier positif en unités mineures, devise
 * ISO 4217 prise en charge, statut SUCCESS | FAILED.
 */
export interface WebhookVerifier {
  readonly provider: string;
  verify(headers: Headers, rawBody: Buffer, now: Date): PaymentNotification;
}

function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(receivedHex) || receivedHex.length !== expectedHex.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(receivedHex, 'hex'));
}

function finalize(n: Record<string, unknown>): PaymentNotification {
  const parsed = paymentNotificationSchema.safeParse(n);
  if (!parsed.success) throw new WebhookRejected('PAYLOAD');
  return parsed.data;
}

function json(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebhookRejected('PAYLOAD');
  }
}

/** Montant exprimé en unités majeures (nombre JSON) → unités mineures, sans arithmétique flottante. */
export function majorToMinor(amount: unknown, currency: string): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)
    throw new WebhookRejected('PAYLOAD');
  try {
    // String(n) donne la plus courte écriture décimale exacte du nombre JSON reçu
    return toMinor(String(amount), currency.toUpperCase()).toString();
  } catch (e) {
    if (e instanceof MoneyError) throw new WebhookRejected('PAYLOAD');
    throw e;
  }
}

// ------------------------------------------------------------------ PSP simulé

const simulatedBody = z.object({
  id: z.string().min(8).max(100),
  reference: z.string().min(4).max(100),
  merchantReference: z.string(),
  status: z.enum(['SUCCESS', 'FAILED']),
  amountMinor: z.string(),
  currency: z.string(),
  failureReason: z.string().max(200).nullable().optional(),
});

/** `x-psp-signature` = HMAC-SHA256(secret, `${x-psp-timestamp}.${corps brut}`), horodatage borné. */
export class SimulatedPspVerifier implements WebhookVerifier {
  constructor(
    readonly provider: string,
    private readonly secret: string,
    private readonly toleranceSeconds: number,
  ) {}

  verify(headers: Headers, rawBody: Buffer, now: Date): PaymentNotification {
    const sig = header(headers, 'x-psp-signature') ?? '';
    const tsRaw = header(headers, 'x-psp-timestamp') ?? '';
    if (!/^\d{9,12}$/.test(tsRaw) || !/^[0-9a-f]{64}$/.test(sig))
      throw new WebhookRejected('SIGNATURE');
    const expected = createHmac('sha256', this.secret)
      .update(`${tsRaw}.${rawBody.toString('utf8')}`)
      .digest('hex');
    if (!safeEqualHex(expected, sig)) throw new WebhookRejected('SIGNATURE');
    const ts = Number(tsRaw) * 1000;
    if (Math.abs(now.getTime() - ts) > this.toleranceSeconds * 1000)
      throw new WebhookRejected('TIMESTAMP');
    const body = simulatedBody.safeParse(json(rawBody));
    if (!body.success) throw new WebhookRejected('PAYLOAD');
    const b = body.data;
    return finalize({
      provider: this.provider,
      providerEventId: b.id,
      providerReference: b.reference,
      merchantReference: b.merchantReference,
      status: b.status,
      amountMinor: b.amountMinor,
      currency: b.currency.toUpperCase(),
      failureReason: b.failureReason ?? null,
      occurredAt: new Date(ts).toISOString(),
    });
  }
}

// ------------------------------------------------------------------ intégrations réelles préparées

const flutterwaveBody = z.object({
  event: z.string().optional(),
  data: z.object({
    id: z.union([z.number(), z.string()]),
    tx_ref: z.string(),
    flw_ref: z.string(),
    amount: z.number(),
    currency: z.string(),
    status: z.string(),
    created_at: z.string().datetime({ offset: true }),
  }),
});

/**
 * Flutterwave : en-tête `verif-hash` égal au secret configuré. Pas d'horodatage signé : le
 * non-rejeu repose sur l'identifiant d'événement (journal du gateway). Désactivé (A-47).
 */
export class FlutterwaveVerifier implements WebhookVerifier {
  readonly provider = 'flutterwave';
  constructor(private readonly hash: string) {}

  verify(headers: Headers, rawBody: Buffer): PaymentNotification {
    const sig = header(headers, 'verif-hash') ?? '';
    const a = createHash('sha256').update(sig).digest('hex');
    const b = createHash('sha256').update(this.hash).digest('hex');
    if (!this.hash || !safeEqualHex(a, b)) throw new WebhookRejected('SIGNATURE');
    const body = flutterwaveBody.safeParse(json(rawBody));
    if (!body.success) throw new WebhookRejected('PAYLOAD');
    const d = body.data.data;
    return finalize({
      provider: this.provider,
      providerEventId: String(d.id),
      providerReference: d.flw_ref,
      merchantReference: d.tx_ref,
      status: d.status === 'successful' ? 'SUCCESS' : 'FAILED',
      amountMinor: majorToMinor(d.amount, d.currency),
      currency: d.currency.toUpperCase(),
      failureReason: d.status === 'successful' ? null : `Flutterwave : ${d.status}`.slice(0, 200),
      occurredAt: new Date(d.created_at).toISOString(),
    });
  }
}

const paystackBody = z.object({
  event: z.string(),
  data: z.object({
    id: z.number().int(),
    reference: z.string(),
    status: z.string(),
    amount: z.number().int().positive(),
    currency: z.string(),
    paid_at: z.string().datetime({ offset: true }).nullable().optional(),
    created_at: z.string().datetime({ offset: true }).optional(),
    metadata: z.object({ merchantReference: z.string() }).optional(),
  }),
});

/** Paystack : `x-paystack-signature` = HMAC-SHA512(clé secrète, corps brut). Désactivé (A-47). */
export class PaystackVerifier implements WebhookVerifier {
  readonly provider = 'paystack';
  constructor(private readonly secretKey: string) {}

  verify(headers: Headers, rawBody: Buffer): PaymentNotification {
    const sig = header(headers, 'x-paystack-signature') ?? '';
    if (!this.secretKey) throw new WebhookRejected('SIGNATURE');
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    if (!safeEqualHex(expected, sig)) throw new WebhookRejected('SIGNATURE');
    const body = paystackBody.safeParse(json(rawBody));
    if (!body.success) throw new WebhookRejected('PAYLOAD');
    const d = body.data.data;
    const ok = body.data.event === 'charge.success' && d.status === 'success';
    return finalize({
      provider: this.provider,
      providerEventId: `${body.data.event}:${d.id}`,
      providerReference: String(d.id),
      merchantReference: d.metadata?.merchantReference ?? d.reference,
      status: ok ? 'SUCCESS' : 'FAILED',
      // Paystack exprime déjà les montants en unités mineures (kobo, pesewas…)
      amountMinor: String(d.amount),
      currency: d.currency.toUpperCase(),
      failureReason: ok ? null : `Paystack : ${d.status}`.slice(0, 200),
      occurredAt: new Date(d.paid_at ?? d.created_at ?? 0).toISOString(),
    });
  }
}
