/**
 * Abstraction des prestataires de paiement (prompt §10). Les montants sont en unités mineures.
 * Seuls les adaptateurs SIMULÉS sont actifs ; les adaptateurs Flutterwave / Paystack sont des
 * squelettes qui refusent toute opération (aucune transaction réelle ne peut être déclenchée).
 */

export type PspStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

export interface CollectRequest {
  /** Référence marchande = identifiant du paiement interne (idempotence côté PSP). */
  merchantReference: string;
  amountMinor: bigint;
  currency: string;
  /** Mobile Money : numéro E.164 ; carte : absent (page hébergée). */
  phone?: string | null;
  customer: { id: string; email: string | null; name: string };
  returnUrl?: string;
}

export interface CollectResult {
  providerReference: string;
  status: PspStatus;
  /** Carte : URL de la page 3-D Secure hébergée par le PSP. */
  redirectUrl?: string | null;
  /** Mobile Money : message affiché à l'utilisateur (USSD push envoyé). */
  instructions?: string | null;
}

export interface PayoutRequest {
  merchantReference: string;
  amountMinor: bigint;
  currency: string;
  phone: string;
}

export interface RefundRequest {
  merchantReference: string;
  originalProviderReference: string;
  amountMinor: bigint;
  currency: string;
  reason: string;
}

export interface StatusResult {
  providerReference: string;
  status: PspStatus;
  amountMinor: bigint;
  currency: string;
  failureReason?: string | null;
}

/** Événement de webhook après vérification de signature (et normalisation). */
export interface WebhookEvent {
  providerEventId: string;
  providerReference: string;
  merchantReference: string;
  status: 'SUCCESS' | 'FAILED';
  amountMinor: bigint;
  currency: string;
  failureReason?: string | null;
  /** Horodatage signé par le PSP (anti-rejeu). */
  timestamp: Date;
}

export interface StatementLine {
  providerReference: string;
  merchantReference: string;
  kind: string;
  status: PspStatus;
  amountMinor: bigint;
  currency: string;
  settledAt: Date | null;
}

export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message = `Prestataire ${provider} indisponible`,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** Refus explicite : intégration réelle non activée (garde-fou « aucune transaction réelle »). */
export class ProviderDisabledError extends Error {
  constructor(readonly provider: string) {
    super(`Intégration ${provider} désactivée : seuls les prestataires simulés sont autorisés`);
    this.name = 'ProviderDisabledError';
  }
}

export class InvalidWebhookError extends Error {
  constructor(readonly reason: 'SIGNATURE' | 'TIMESTAMP' | 'PAYLOAD') {
    super(`Webhook refusé (${reason})`);
    this.name = 'InvalidWebhookError';
  }
}

export abstract class PaymentProvider {
  abstract readonly name: string;
  /** Faux pour les squelettes réels : le registre ne les sélectionne jamais. */
  abstract readonly enabled: boolean;
  abstract collectMobileMoney(req: CollectRequest): Promise<CollectResult>;
  abstract collectCard(req: CollectRequest): Promise<CollectResult>;
  abstract payout(req: PayoutRequest): Promise<CollectResult>;
  abstract refund(req: RefundRequest): Promise<CollectResult>;
  abstract status(providerReference: string): Promise<StatusResult>;
  /** Vérifie signature + horodatage et normalise le corps brut. */
  abstract parseWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
    now: Date,
  ): WebhookEvent;
  /** Relevé des opérations d'une journée (UTC) — réconciliation PSP (US-7.6). */
  abstract statement(day: string): Promise<StatementLine[]>;
}
