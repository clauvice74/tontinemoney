import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { MoneyError, toMinor } from '@tontine/contracts';
import {
  type CollectRequest,
  type CollectResult,
  InvalidWebhookError,
  PaymentProvider,
  type PayoutRequest,
  ProviderDisabledError,
  type RefundRequest,
  type StatementLine,
  type StatusResult,
  type WebhookEvent,
} from './payment-provider';

/**
 * Squelettes Flutterwave et Paystack (prompt §10) : interfaces prêtes, vérification des webhooks
 * implémentée selon la documentation publique des prestataires, mais TOUTE opération financière
 * lève `ProviderDisabledError`. Aucune requête réseau n'est émise. Activer un vrai prestataire
 * exige : contrat, clés de production dans un coffre-fort, revue de sécurité et PCI-DSS (README §Production).
 */
abstract class DisabledRealProvider extends PaymentProvider {
  readonly enabled = false;

  async collectMobileMoney(_req: CollectRequest): Promise<CollectResult> {
    throw new ProviderDisabledError(this.name);
  }
  async collectCard(_req: CollectRequest): Promise<CollectResult> {
    throw new ProviderDisabledError(this.name);
  }
  async payout(_req: PayoutRequest): Promise<CollectResult> {
    throw new ProviderDisabledError(this.name);
  }
  async refund(_req: RefundRequest): Promise<CollectResult> {
    throw new ProviderDisabledError(this.name);
  }
  async status(_ref: string): Promise<StatusResult> {
    throw new ProviderDisabledError(this.name);
  }
  async statement(_day: string): Promise<StatementLine[]> {
    throw new ProviderDisabledError(this.name);
  }
}

/** Montant en unités majeures (nombre JSON) → unités mineures exactes selon la devise. */
function minorFromMajor(amount: number, currency: string): bigint {
  if (!Number.isFinite(amount) || amount <= 0) throw new InvalidWebhookError('PAYLOAD');
  try {
    return toMinor(String(amount), currency.toUpperCase());
  } catch (e) {
    if (e instanceof MoneyError) throw new InvalidWebhookError('PAYLOAD');
    throw e;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

interface FlutterwaveCharge {
  event?: string;
  data?: {
    id?: number | string;
    tx_ref?: string;
    flw_ref?: string;
    status?: string;
    amount?: number;
    currency?: string;
    created_at?: string;
  };
}

/** Flutterwave : en-tête `verif-hash` égal au secret configuré dans le tableau de bord. */
export class FlutterwaveProvider extends DisabledRealProvider {
  readonly name = 'flutterwave';

  constructor(private readonly webhookHash: string | null) {
    super();
  }

  parseWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
    _now: Date,
  ): WebhookEvent {
    const sig = headers['verif-hash'];
    if (!this.webhookHash || !sig || !safeEqual(sig, this.webhookHash))
      throw new InvalidWebhookError('SIGNATURE');
    const body = JSON.parse(rawBody.toString('utf8')) as FlutterwaveCharge;
    const d = body.data;
    if (!d?.tx_ref || !d.flw_ref || d.amount === undefined || !d.currency)
      throw new InvalidWebhookError('PAYLOAD');
    return {
      providerEventId: String(d.id ?? d.flw_ref),
      providerReference: d.flw_ref,
      merchantReference: d.tx_ref,
      status: d.status === 'successful' ? 'SUCCESS' : 'FAILED',
      // Flutterwave exprime les montants en unités majeures : conversion exacte selon l'exposant
      // de la devise (XAF : 0, NGN : 2…), jamais d'arithmétique flottante (A-47)
      amountMinor: minorFromMajor(d.amount, d.currency),
      currency: d.currency.toUpperCase(),
      timestamp: d.created_at ? new Date(d.created_at) : new Date(0),
    };
  }
}

interface PaystackEvent {
  event?: string;
  data?: {
    id?: number;
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    paid_at?: string;
  };
}

/** Paystack : en-tête `x-paystack-signature` = HMAC-SHA512(clé secrète, corps brut). */
export class PaystackProvider extends DisabledRealProvider {
  readonly name = 'paystack';

  constructor(private readonly secretKey: string | null) {
    super();
  }

  parseWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
    _now: Date,
  ): WebhookEvent {
    const sig = headers['x-paystack-signature'];
    if (!this.secretKey || !sig) throw new InvalidWebhookError('SIGNATURE');
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    if (!safeEqual(sig, expected)) throw new InvalidWebhookError('SIGNATURE');
    const body = JSON.parse(rawBody.toString('utf8')) as PaystackEvent;
    const d = body.data;
    if (!d?.reference || d.amount === undefined || !d.currency)
      throw new InvalidWebhookError('PAYLOAD');
    return {
      providerEventId: String(d.id ?? d.reference),
      providerReference: d.reference,
      merchantReference: d.reference,
      status: body.event === 'charge.success' ? 'SUCCESS' : 'FAILED',
      amountMinor: BigInt(d.amount), // Paystack : unités mineures (kobo, pesewas…)
      currency: d.currency.toUpperCase(),
      timestamp: d.paid_at ? new Date(d.paid_at) : new Date(0),
    };
  }
}
