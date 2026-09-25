import { maskPhone } from '@tontine/contracts';
import { type PrismaService } from '@tontine/platform';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  type CollectRequest,
  type CollectResult,
  InvalidWebhookError,
  PaymentProvider,
  type PayoutRequest,
  ProviderUnavailableError,
  type RefundRequest,
  type StatementLine,
  type StatusResult,
  type WebhookEvent,
} from './payment-provider';

/**
 * PSP SIMULÉ (Mobile Money + carte 3-D Secure fictive), déterministe :
 *  - numéro se terminant par `0003` : prestataire indisponible à l'initiation (retry puis repli) ;
 *  - numéro se terminant par `0001` : le versement (payout) échoue ;
 *  - `setAvailability(false)` : panne complète (circuit breaker, repli sur le PSP de secours).
 * La confirmation d'un encaissement se fait via le simulateur (`/psp-sim/...`) qui émet un
 * webhook signé HMAC-SHA256 (`x-psp-signature` = HMAC(secret, `${timestamp}.${corps}`)).
 */
export const SIGNATURE_HEADER = 'x-psp-signature';
export const TIMESTAMP_HEADER = 'x-psp-timestamp';

export type WebhookSink = (
  provider: string,
  headers: Record<string, string>,
  rawBody: Buffer,
) => Promise<unknown>;

const webhookBody = z.object({
  id: z.string().min(8).max(100),
  reference: z.string().min(4).max(100),
  merchantReference: z.string().uuid(),
  status: z.enum(['SUCCESS', 'FAILED']),
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  failureReason: z.string().max(200).nullable().optional(),
});

export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export interface SimulatedProviderOptions {
  name: string;
  secret: string;
  toleranceSeconds: number;
  checkoutBaseUrl: string;
  now: () => Date;
}

export class SimulatedPspProvider extends PaymentProvider {
  readonly enabled = true;
  private available = true;
  private sink: WebhookSink | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly options: SimulatedProviderOptions,
  ) {
    super();
  }

  get name(): string {
    return this.options.name;
  }

  setAvailability(available: boolean): void {
    this.available = available;
  }

  setWebhookSink(sink: WebhookSink): void {
    this.sink = sink;
  }

  private assertUp(phone?: string | null): void {
    if (!this.available || phone?.endsWith('0003')) throw new ProviderUnavailableError(this.name);
  }

  private async open(
    kind: string,
    req: {
      merchantReference: string;
      amountMinor: bigint;
      currency: string;
      phone?: string | null;
    },
    prefix: string,
  ) {
    // Idempotence côté PSP : même référence marchande → même opération
    const existing = await this.prisma.pspSimOperation.findFirst({
      where: { provider: this.name, merchantReference: req.merchantReference, kind },
    });
    if (existing) return existing;
    return this.prisma.pspSimOperation.create({
      data: {
        provider: this.name,
        reference: `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`,
        kind,
        amountMinor: req.amountMinor,
        currency: req.currency,
        merchantReference: req.merchantReference,
        destinationMasked: req.phone ? maskPhone(req.phone) : null,
        scenario: req.phone?.endsWith('0001') ? 'PAYOUT_FAILS' : null,
        createdAt: this.options.now(),
      },
    });
  }

  async collectMobileMoney(req: CollectRequest): Promise<CollectResult> {
    this.assertUp(req.phone);
    const op = await this.open('COLLECT_MOBILE_MONEY', req, 'SIMMM');
    return {
      providerReference: op.reference,
      status: 'PROCESSING',
      instructions: `Demande USSD envoyée au ${op.destinationMasked ?? ''} : validez le paiement sur votre téléphone (simulation).`,
    };
  }

  async collectCard(req: CollectRequest): Promise<CollectResult> {
    this.assertUp();
    const op = await this.open('COLLECT_CARD', req, 'SIMCARD');
    return {
      providerReference: op.reference,
      status: 'PROCESSING',
      redirectUrl: `${this.options.checkoutBaseUrl.replace(/\/$/, '')}/api/v1/psp-sim/checkout/${op.reference}`,
    };
  }

  async payout(req: PayoutRequest): Promise<CollectResult> {
    this.assertUp(req.phone);
    const op = await this.open('PAYOUT', req, 'SIMPO');
    return { providerReference: op.reference, status: 'PROCESSING' };
  }

  async refund(req: RefundRequest): Promise<CollectResult> {
    this.assertUp();
    const original = await this.prisma.pspSimOperation.findUnique({
      where: { reference: req.originalProviderReference },
    });
    if (!original || original.status !== 'SUCCESS')
      throw new Error('Opération d’origine introuvable ou non réglée');
    const op = await this.open('REFUND', req, 'SIMRF');
    // Les remboursements simulés sont réglés immédiatement (synchrones).
    const settled = await this.prisma.pspSimOperation.update({
      where: { id: op.id },
      data: { status: 'SUCCESS', settledAt: this.options.now() },
    });
    return { providerReference: settled.reference, status: 'SUCCESS' };
  }

  async status(providerReference: string): Promise<StatusResult> {
    this.assertUp();
    const op = await this.prisma.pspSimOperation.findUnique({
      where: { reference: providerReference },
    });
    if (!op) throw new Error('Référence inconnue du PSP simulé');
    return {
      providerReference: op.reference,
      status: op.status === 'PENDING' ? 'PROCESSING' : (op.status as StatusResult['status']),
      amountMinor: op.amountMinor,
      currency: op.currency,
      failureReason: op.status === 'FAILED' ? 'Refusé par l’opérateur (simulation)' : null,
    };
  }

  /**
   * Simulateur : règle une opération (validation USSD, page 3-D Secure, versement) et émet le
   * webhook signé. `deliver = false` simule un callback perdu (le polling prend le relais).
   */
  async settle(
    reference: string,
    outcome: 'SUCCESS' | 'FAILURE',
    deliver = true,
  ): Promise<{ delivered: boolean; kind: string }> {
    const op = await this.prisma.pspSimOperation.findUnique({ where: { reference } });
    if (!op || op.provider !== this.name) throw new Error('Référence inconnue');
    if (op.status !== 'PENDING') return { delivered: false, kind: op.kind };
    const failed =
      outcome === 'FAILURE' || (op.kind === 'PAYOUT' && op.scenario === 'PAYOUT_FAILS');
    const updated = await this.prisma.pspSimOperation.update({
      where: { id: op.id },
      data: { status: failed ? 'FAILED' : 'SUCCESS', settledAt: this.options.now() },
    });
    if (!deliver || !this.sink) return { delivered: false, kind: op.kind };
    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      reference: updated.reference,
      merchantReference: updated.merchantReference,
      status: updated.status,
      amountMinor: updated.amountMinor.toString(),
      currency: updated.currency,
      failureReason: failed ? 'Refusé par l’opérateur (simulation)' : null,
    });
    await this.sink(this.name, this.signedHeaders(body), Buffer.from(body));
    return { delivered: true, kind: op.kind };
  }

  signedHeaders(body: string, at: Date = this.options.now()): Record<string, string> {
    const ts = Math.floor(at.getTime() / 1000);
    return {
      [SIGNATURE_HEADER]: signWebhook(this.options.secret, ts, body),
      [TIMESTAMP_HEADER]: String(ts),
      'content-type': 'application/json',
    };
  }

  parseWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
    now: Date,
  ): WebhookEvent {
    const sig = headers[SIGNATURE_HEADER] ?? '';
    const tsRaw = headers[TIMESTAMP_HEADER] ?? '';
    if (!/^\d{9,12}$/.test(tsRaw) || !/^[0-9a-f]{64}$/.test(sig))
      throw new InvalidWebhookError('SIGNATURE');
    const expected = Buffer.from(
      signWebhook(this.options.secret, Number(tsRaw), rawBody.toString('utf8')),
      'hex',
    );
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex')))
      throw new InvalidWebhookError('SIGNATURE');
    const ts = new Date(Number(tsRaw) * 1000);
    if (Math.abs(now.getTime() - ts.getTime()) > this.options.toleranceSeconds * 1000)
      throw new InvalidWebhookError('TIMESTAMP');
    let parsed: z.infer<typeof webhookBody>;
    try {
      parsed = webhookBody.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new InvalidWebhookError('PAYLOAD');
    }
    return {
      providerEventId: parsed.id,
      providerReference: parsed.reference,
      merchantReference: parsed.merchantReference,
      status: parsed.status,
      amountMinor: BigInt(parsed.amountMinor),
      currency: parsed.currency.toUpperCase(),
      failureReason: parsed.failureReason ?? null,
      timestamp: ts,
    };
  }

  async statement(day: string): Promise<StatementLine[]> {
    const from = new Date(`${day}T00:00:00Z`);
    const to = new Date(from.getTime() + 86_400_000);
    const ops = await this.prisma.pspSimOperation.findMany({
      where: { provider: this.name, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'asc' },
    });
    return ops.map((o) => ({
      providerReference: o.reference,
      merchantReference: o.merchantReference,
      kind: o.kind,
      status: o.status === 'PENDING' ? 'PROCESSING' : (o.status as StatementLine['status']),
      amountMinor: o.amountMinor,
      currency: o.currency,
      settledAt: o.settledAt,
    }));
  }
}
