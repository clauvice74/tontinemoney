import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataCipher } from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { ComplianceService } from '@tontine/compliance';
import {
  type DepositInput,
  type PaymentNotification,
  type WithdrawalInput,
  type WithdrawalRequestInput,
  maskPhone,
  moneyView,
  normalizePhone,
  toMinor,
} from '@tontine/contracts';
import {
  type Payment,
  type PaymentStatus,
  type TxClient,
  isUniqueViolation,
} from '@tontine/database';
import {
  APP_CONFIG,
  type Actor,
  AuditService,
  CircuitOpenError,
  Clock,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  STEP_UP,
  type StepUpPort,
  OutboxService,
  PrismaService,
  ScheduledJob,
  UnitOfWork,
  kycAtLeast,
} from '@tontine/platform';
import { TransactionsService } from '@tontine/transactions';
import { LedgerService, WalletsService } from '@tontine/wallets';
import { ProviderRegistry } from './provider-registry';
import {
  type CollectResult,
  InvalidWebhookError,
  ProviderDisabledError,
  ProviderUnavailableError,
  type WebhookEvent,
} from './providers/payment-provider';

/** US-7.4 : sans callback après 5 min, le statut est interrogé (polling). */
export const POLL_AFTER_MS = 5 * 60_000;
/** Expiration d'un paiement non confirmé. */
export const PAYMENT_TTL_MS: Record<'DEPOSIT' | 'WITHDRAWAL' | 'REFUND', number> = {
  DEPOSIT: 30 * 60_000,
  WITHDRAWAL: 6 * 3600_000,
  REFUND: 24 * 3600_000,
};
const OPEN: PaymentStatus[] = ['PENDING', 'PROCESSING'];

export function paymentView(p: Payment, extra: { instructions?: string | null } = {}) {
  return {
    id: p.id,
    type: p.type,
    method: p.method,
    status: p.status,
    amount: moneyView(p.amountMinor, p.currency),
    provider: p.provider,
    providerReference: p.providerReference,
    destination: p.destinationMasked,
    redirectUrl: p.status === 'PROCESSING' ? p.redirectUrl : null,
    instructions: extra.instructions ?? null,
    transactionId: p.transactionId,
    refundOfId: p.refundOfId,
    errorCode: p.errorCode,
    errorMessage: p.errorMessage,
    fallbackUsed: p.fallbackUsed,
    expiresAt: p.expiresAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export type WebhookOutcome =
  'PROCESSED' | 'DUPLICATE' | 'IGNORED' | 'AMOUNT_MISMATCH' | 'UNKNOWN_PAYMENT';

/**
 * Paiements PSP (épique 7) : dépôts Mobile Money / carte, retraits, remboursements, machine à
 * états PENDING → PROCESSING → COMPLETED | FAILED | EXPIRED (| REFUNDED), webhooks signés, polling.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly cipher: DataCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly registry: ProviderRegistry,
    private readonly compliance: ComplianceService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly transactions: TransactionsService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
    @Inject(STEP_UP) private readonly stepUp: StepUpPort,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.cipher = new DataCipher(config.DATA_ENCRYPTION_KEY);
    const gateway = config.PAYMENT_GATEWAY_URL.replace(/\/$/, '');
    for (const sim of this.registry.allSimulated()) {
      sim.setWebhookSink((provider, headers, raw) =>
        config.PSP_WEBHOOK_DELIVERY === 'http'
          ? this.deliverToGateway(`${gateway}/api/v1/webhooks/payments/${provider}`, headers, raw)
          : this.receiveWebhook(provider, headers, raw),
      );
    }
  }

  /**
   * Simulateur : webhook envoyé au Payment Gateway comme le ferait un PSP réel. Un échec de
   * livraison n'est pas bloquant : le polling (US-7.4) résout le paiement.
   */
  private async deliverToGateway(
    url: string,
    headers: Record<string, string>,
    raw: Buffer,
  ): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: new Uint8Array(raw),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.logger.warn(`Webhook simulé refusé par le Payment Gateway (${res.status})`);
    } catch (e) {
      this.logger.warn(
        `Payment Gateway injoignable, résolution par polling : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async history(
    tx: TxClient,
    paymentId: string,
    from: PaymentStatus | null,
    to: PaymentStatus,
    reason?: string | null,
  ): Promise<void> {
    await tx.paymentStatusHistory.create({
      data: {
        paymentId,
        fromStatus: from,
        toStatus: to,
        reason: reason ?? null,
        createdAt: this.clock.now(),
      },
    });
  }

  private async memberWallet(memberId: string, currency: string) {
    const w = await this.prisma.wallet.findUnique({ where: { memberId } });
    if (!w) throw new DomainError('NOT_FOUND', 'Portefeuille introuvable');
    if (w.currency !== currency)
      throw new DomainError('CURRENCY_MISMATCH', `Votre portefeuille est en ${w.currency}`);
    if (w.status !== 'ACTIVE')
      throw new DomainError('WALLET_NOT_OPERATIONAL', 'Portefeuille non actif');
    return w;
  }

  // ------------------------------------------------------------------ US-7.1 / US-7.2 dépôt
  async deposit(actor: Actor, input: DepositInput, idempotencyKey: string) {
    const key = `deposit:${actor.userId}:${idempotencyKey}`;
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: key } });
    if (existing) return paymentView(existing);
    const member = await this.members.snapshot(actor.userId);
    if (!member) throw new DomainError('NOT_FOUND', 'Profil membre introuvable');
    const currency = input.currency.toUpperCase();
    const amountMinor = toMinor(input.amount, currency);
    const wallet = await this.memberWallet(actor.userId, currency);
    await this.compliance.assertCompliant({
      operationType: 'DEPOSIT',
      memberId: actor.userId,
      amountMinor,
      currency,
      creditMemberId: actor.userId,
      context: { method: input.method },
    });
    const phone = input.method === 'MOBILE_MONEY' ? normalizePhone(input.phone!) : null;
    const now = this.clock.now();
    let payment: Payment;
    try {
      payment = await this.uow.run(async (tx) => {
        const p = await tx.payment.create({
          data: {
            type: 'DEPOSIT',
            method: input.method,
            amountMinor,
            currency,
            provider: 'pending',
            memberId: actor.userId,
            walletId: wallet.id,
            destinationMasked: phone ? maskPhone(phone) : null,
            destinationEnc: phone
              ? this.cipher.encryptString(phone, `payment:${actor.userId}`)
              : null,
            idempotencyKey: key,
            expiresAt: new Date(now.getTime() + PAYMENT_TTL_MS.DEPOSIT),
            nextPollAt: new Date(now.getTime() + POLL_AFTER_MS),
            createdAt: now,
          },
        });
        await this.history(tx, p.id, null, 'PENDING');
        await this.outbox.add(tx, {
          type: 'payment.initiated',
          aggregateType: 'payment',
          aggregateId: p.id,
          payload: {
            paymentId: p.id,
            type: 'DEPOSIT',
            method: p.method,
            amountMinor: amountMinor.toString(),
            currency,
            memberId: actor.userId,
          },
        });
        return p;
      });
    } catch (e) {
      if (isUniqueViolation(e))
        return paymentView(
          await this.prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: key } }),
        );
      throw e;
    }
    const customer = {
      id: actor.userId,
      email: member.email,
      name: `${member.firstName} ${member.lastName}`,
    };
    return this.dispatch(payment, (p) =>
      input.method === 'MOBILE_MONEY'
        ? p.collectMobileMoney({
            merchantReference: payment.id,
            amountMinor,
            currency,
            phone,
            customer,
          })
        : p.collectCard({ merchantReference: payment.id, amountMinor, currency, customer }),
    );
  }

  /** Envoi au PSP (rejeu, disjoncteur, repli) puis passage en PROCESSING, ou FAILED si tout échoue. */
  private async dispatch(payment: Payment, call: Parameters<ProviderRegistry['initiate']>[0]) {
    let res: Awaited<ReturnType<ProviderRegistry['initiate']>>;
    try {
      res = await this.registry.initiate(call);
    } catch (e) {
      const reason =
        e instanceof ProviderDisabledError ? e.message : 'Prestataires de paiement indisponibles';
      await this.fail(payment.id, 'PROVIDER_UNAVAILABLE', reason);
      if (
        e instanceof ProviderUnavailableError ||
        e instanceof CircuitOpenError ||
        e instanceof ProviderDisabledError
      ) {
        throw new DomainError(
          'PROVIDER_UNAVAILABLE',
          'Service de paiement momentanément indisponible, réessayez plus tard',
          { paymentId: payment.id },
        );
      }
      throw e;
    }
    const r: CollectResult = res.result;
    const updated = await this.uow.run(async (tx) => {
      const u = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PROCESSING',
          provider: res.provider.name,
          providerReference: r.providerReference,
          redirectUrl: r.redirectUrl ?? null,
          fallbackUsed: res.fallbackUsed,
          retryCount: Math.max(0, res.attempts - 1),
        },
      });
      await this.history(
        tx,
        u.id,
        'PENDING',
        'PROCESSING',
        res.fallbackUsed ? `Repli vers ${res.provider.name}` : null,
      );
      await this.outbox.add(tx, {
        type: 'payment.processing',
        aggregateType: 'payment',
        aggregateId: u.id,
        payload: { paymentId: u.id, provider: res.provider.name },
      });
      return u;
    });
    return paymentView(updated, { instructions: r.instructions ?? null });
  }

  // ------------------------------------------------------------------ US-7.3 retrait
  /** Contrôles communs à la demande de code et au retrait : membre, KYC, portefeuille. */
  private async withdrawalContext(actor: Actor, input: WithdrawalRequestInput) {
    const member = await this.members.snapshot(actor.userId);
    if (!member || member.status !== 'ACTIVE')
      throw new DomainError('MEMBER_NOT_ELIGIBLE', 'Compte non actif');
    if (!kycAtLeast(member.kycLevel, 'TIER_2'))
      throw new DomainError(
        'KYC_LEVEL_INSUFFICIENT',
        'Vérification d’identité de niveau 2 requise pour un retrait',
      );
    const currency = input.currency.toUpperCase();
    const amountMinor = toMinor(input.amount, currency);
    const wallet = await this.memberWallet(actor.userId, currency);
    const phone = normalizePhone(input.phone);
    // Le code ne vaut que pour ce montant, cette devise et ce numéro (A-59).
    const binding = `${amountMinor}:${currency}:${phone}`;
    return { currency, amountMinor, wallet, phone, binding };
  }

  /** A-59 — code de confirmation du retrait (SMS, ou e-mail à défaut), valable 5 minutes. */
  async requestWithdrawalCode(actor: Actor, input: WithdrawalRequestInput) {
    const { amountMinor, wallet, binding } = await this.withdrawalContext(actor, input);
    if (wallet.balanceMinor - wallet.blockedMinor < amountMinor)
      throw new DomainError('INSUFFICIENT_FUNDS', 'Solde disponible insuffisant');
    return this.stepUp.issue(actor.userId, 'WITHDRAWAL', binding);
  }

  async withdraw(actor: Actor, input: WithdrawalInput, idempotencyKey: string) {
    const key = `withdrawal:${actor.userId}:${idempotencyKey}`;
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: key } });
    if (existing) return paymentView(existing);
    const { currency, amountMinor, wallet, phone, binding } = await this.withdrawalContext(
      actor,
      input,
    );
    await this.stepUp.verify(actor.userId, 'WITHDRAWAL', input.otpChallengeId, input.otp, binding);
    await this.compliance.assertCompliant({
      operationType: 'WITHDRAWAL',
      memberId: actor.userId,
      amountMinor,
      currency,
      context: { method: input.method },
    });
    const now = this.clock.now();
    const payment = await this.uow.run(
      async (tx) => {
        const p = await tx.payment.create({
          data: {
            type: 'WITHDRAWAL',
            method: 'MOBILE_MONEY',
            amountMinor,
            currency,
            provider: 'pending',
            memberId: actor.userId,
            walletId: wallet.id,
            destinationMasked: maskPhone(phone),
            destinationEnc: this.cipher.encryptString(phone, `payment:${actor.userId}`),
            idempotencyKey: key,
            expiresAt: new Date(now.getTime() + PAYMENT_TTL_MS.WITHDRAWAL),
            nextPollAt: new Date(now.getTime() + POLL_AFTER_MS),
            createdAt: now,
          },
        });
        // US-7.3 : blocage des fonds avant l'envoi au PSP (INSUFFICIENT_FUNDS annule tout)
        const hold = await this.ledger.createHold(tx, {
          walletId: wallet.id,
          amountMinor,
          context: 'WITHDRAWAL',
          referenceId: p.id,
          idempotencyKey: `withdrawal:${p.id}`,
          ttlSeconds: PAYMENT_TTL_MS.WITHDRAWAL / 1000 + 3600,
        });
        const withHold = await tx.payment.update({
          where: { id: p.id },
          data: { holdId: hold.id },
        });
        await this.history(tx, p.id, null, 'PENDING');
        await this.outbox.add(tx, {
          type: 'payment.initiated',
          aggregateType: 'payment',
          aggregateId: p.id,
          payload: {
            paymentId: p.id,
            type: 'WITHDRAWAL',
            method: 'MOBILE_MONEY',
            amountMinor: amountMinor.toString(),
            currency,
            memberId: actor.userId,
          },
        });
        return withHold;
      },
      { isolationLevel: 'Serializable', retries: 5 },
    );
    return this.dispatch(payment, (p) =>
      p.payout({ merchantReference: payment.id, amountMinor, currency, phone }),
    );
  }

  // ------------------------------------------------------------------ machine à états
  private async fail(
    paymentId: string,
    code: string,
    reason: string,
    to: 'FAILED' | 'EXPIRED' = 'FAILED',
  ): Promise<boolean> {
    return this.uow.run(
      async (tx) => {
        const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        const res = await tx.payment.updateMany({
          where: { id: p.id, status: { in: OPEN } },
          data: { status: to, errorCode: code, errorMessage: reason.slice(0, 300) },
        });
        if (res.count !== 1) return false;
        if (p.holdId) await this.ledger.releaseHold(tx, p.holdId);
        await this.history(tx, p.id, p.status, to, reason);
        await this.outbox.add(
          tx,
          to === 'EXPIRED'
            ? {
                type: 'payment.expired',
                aggregateType: 'payment',
                aggregateId: p.id,
                payload: { paymentId: p.id, type: p.type, memberId: p.memberId },
              }
            : {
                type: 'payment.failed',
                aggregateType: 'payment',
                aggregateId: p.id,
                payload: { paymentId: p.id, type: p.type, memberId: p.memberId, reason },
              },
        );
        return true;
      },
      { isolationLevel: 'Serializable', retries: 5 },
    );
  }

  /** Applique un résultat PSP (webhook ou polling). Idempotent ; contrôle montant + devise. */
  async applyResult(
    paymentId: string,
    result: {
      status: 'SUCCESS' | 'FAILED';
      amountMinor: bigint;
      currency: string;
      failureReason?: string | null;
      providerReference?: string;
    },
    source: 'webhook' | 'poll',
  ): Promise<WebhookOutcome> {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) return 'UNKNOWN_PAYMENT';
    if (
      result.providerReference &&
      p.providerReference &&
      result.providerReference !== p.providerReference
    )
      return 'IGNORED';
    if (!OPEN.includes(p.status)) return 'DUPLICATE';
    if (result.amountMinor !== p.amountMinor || result.currency !== p.currency) {
      // Jamais de crédit sur un montant ou une devise divergents : alerte + réconciliation
      this.logger.error(`Paiement ${p.id} : montant/devise divergents (${source})`);
      await this.prisma.payment.update({
        where: { id: p.id },
        data: {
          errorCode: 'AMOUNT_MISMATCH',
          errorMessage: `PSP : ${result.amountMinor} ${result.currency}`,
        },
      });
      await this.audit.record({
        action: 'payment.amount_mismatch',
        resourceType: 'payment',
        resourceId: p.id,
        result: 'FAILURE',
        metadata: {
          source,
          expected: `${p.amountMinor} ${p.currency}`,
          received: `${result.amountMinor} ${result.currency}`,
        },
      });
      return 'AMOUNT_MISMATCH';
    }
    if (result.status === 'FAILED') {
      await this.fail(
        p.id,
        'PSP_DECLINED',
        result.failureReason ?? 'Paiement refusé par le prestataire',
      );
      return 'PROCESSED';
    }
    await this.uow.run(async (tx) => {
      const res = await tx.payment.updateMany({
        where: { id: p.id, status: { in: OPEN } },
        data: {
          status: 'COMPLETED',
          completedAt: this.clock.now(),
          errorCode: null,
          errorMessage: null,
        },
      });
      if (res.count !== 1) return;
      await this.history(tx, p.id, p.status, 'COMPLETED', source);
      await this.outbox.add(tx, {
        type: 'payment.completed',
        aggregateType: 'payment',
        aggregateId: p.id,
        payload: {
          paymentId: p.id,
          type: p.type,
          memberId: p.memberId,
          amountMinor: p.amountMinor.toString(),
          currency: p.currency,
          transactionId: null,
          walletId: p.walletId,
          holdId: p.holdId,
          description:
            p.type === 'DEPOSIT'
              ? p.method === 'CARD'
                ? 'Dépôt par carte'
                : 'Dépôt Mobile Money'
              : `Retrait vers ${p.destinationMasked ?? 'Mobile Money'}`,
        },
      });
    });
    return 'PROCESSED';
  }

  /**
   * US-5.3 / US-7.3 — issue de la saga de règlement (Transaction Service, étape 5) :
   * rattachement de la transaction interne au paiement. Idempotent.
   */
  async recordSettlement(paymentId: string, transactionId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, transactionId: null },
      data: { transactionId, errorCode: null, errorMessage: null },
    });
  }

  /**
   * Règlement interne impossible alors que le PSP a exécuté le paiement : le paiement reste
   * COMPLETED côté prestataire, l'anomalie est tracée pour réconciliation (A-53).
   */
  async recordSettlementFailure(paymentId: string, code: string, reason: string): Promise<void> {
    const res = await this.prisma.payment.updateMany({
      where: { id: paymentId, transactionId: null },
      data: { errorCode: 'SETTLEMENT_FAILED', errorMessage: `${code} : ${reason}`.slice(0, 500) },
    });
    if (res.count === 1)
      await this.audit.record({
        action: 'payment.settlement.failed',
        resourceType: 'payment',
        resourceId: paymentId,
        result: 'FAILURE',
        metadata: { code, reason },
      });
  }

  // ------------------------------------------------------------------ webhooks
  async receiveWebhook(
    providerName: string,
    headers: Record<string, string | undefined>,
    rawBody: Buffer | undefined,
  ): Promise<{ received: true; result: WebhookOutcome }> {
    const provider = this.registry.get(providerName);
    if (!provider) throw new DomainError('NOT_FOUND', 'Prestataire inconnu');
    if (!rawBody?.length) throw new DomainError('VALIDATION_FAILED', 'Corps de webhook vide');
    let event: WebhookEvent;
    try {
      event = provider.parseWebhook(headers, rawBody, this.clock.now());
    } catch (e) {
      const reason = e instanceof InvalidWebhookError ? e.reason : 'PAYLOAD';
      await this.audit.record({
        action: 'payment.webhook.rejected',
        resourceType: 'psp',
        resourceId: providerName,
        result: 'DENIED',
        metadata: { reason },
      });
      if (reason === 'PAYLOAD') throw new DomainError('VALIDATION_FAILED', 'Webhook illisible');
      throw new DomainError(
        'INVALID_SIGNATURE',
        reason === 'TIMESTAMP' ? 'Horodatage hors tolérance (anti-rejeu)' : 'Signature invalide',
      );
    }
    return this.processEvent(providerName, event);
  }

  /**
   * Notification normalisée reçue du Payment Gateway (appel interne signé) : la signature du PSP
   * a été vérifiée par le gateway ; les contrôles métier (paiement, montant, devise, statut,
   * idempotence) restent ici.
   */
  async receiveNotification(
    n: PaymentNotification,
  ): Promise<{ received: true; result: WebhookOutcome }> {
    if (!this.registry.get(n.provider)?.enabled)
      throw new DomainError('NOT_FOUND', 'Prestataire inconnu ou désactivé');
    return this.processEvent(n.provider, {
      providerEventId: n.providerEventId,
      providerReference: n.providerReference,
      merchantReference: n.merchantReference,
      status: n.status,
      amountMinor: BigInt(n.amountMinor),
      currency: n.currency,
      failureReason: n.failureReason,
      timestamp: new Date(n.occurredAt),
    });
  }

  /** Anti-rejeu / idempotence : un identifiant d'événement n'est traité qu'une fois. */
  private async processEvent(
    providerName: string,
    event: WebhookEvent,
  ): Promise<{ received: true; result: WebhookOutcome }> {
    let row;
    try {
      row = await this.prisma.pspWebhookEvent.create({
        data: {
          provider: providerName,
          providerEventId: event.providerEventId,
          signatureValid: true,
          payload: {
            reference: event.providerReference,
            merchantReference: event.merchantReference,
            status: event.status,
            amountMinor: event.amountMinor.toString(),
            currency: event.currency,
          },
          result: 'RECEIVED',
          receivedAt: this.clock.now(),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return { received: true, result: 'DUPLICATE' };
      throw e;
    }
    const valid = /^[0-9a-f-]{36}$/i.test(event.merchantReference);
    const result = valid
      ? await this.applyResult(
          event.merchantReference,
          {
            status: event.status,
            amountMinor: event.amountMinor,
            currency: event.currency,
            failureReason: event.failureReason,
            providerReference: event.providerReference,
          },
          'webhook',
        )
      : 'UNKNOWN_PAYMENT';
    await this.prisma.pspWebhookEvent.update({
      where: { id: row.id },
      data: { result, processedAt: this.clock.now() },
    });
    return { received: true, result };
  }

  // ------------------------------------------------------------------ US-7.4 polling / expiration
  @ScheduledJob({
    name: 'payments.poll',
    cron: '0 * * * * *',
    description: 'Polling PSP des paiements sans callback après 5 min + expiration (US-7.4)',
  })
  async poll(): Promise<{ checked: number; resolved: number; expired: number }> {
    const now = this.clock.now();
    const due = await this.prisma.payment.findMany({
      where: {
        status: { in: OPEN },
        OR: [{ nextPollAt: { lte: now } }, { expiresAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let resolved = 0;
    let expired = 0;
    for (const p of due) {
      const provider = this.registry.get(p.provider);
      if (provider && p.providerReference) {
        try {
          const { result } = await this.registry.call(provider, (pr) =>
            pr.status(p.providerReference!),
          );
          if (result.status === 'SUCCESS' || result.status === 'FAILED') {
            await this.applyResult(
              p.id,
              {
                status: result.status,
                amountMinor: result.amountMinor,
                currency: result.currency,
                failureReason: result.failureReason,
              },
              'poll',
            );
            resolved++;
            continue;
          }
        } catch (e) {
          this.logger.warn(`Polling ${p.id} impossible : ${(e as Error).message}`);
        }
      }
      if (p.expiresAt <= now) {
        if (await this.fail(p.id, 'EXPIRED', 'Délai de confirmation dépassé', 'EXPIRED')) expired++;
        continue;
      }
      // Backoff exponentiel du polling : 5 min, 10 min, 20 min… (max 1 h)
      const delay = Math.min(POLL_AFTER_MS * 2 ** Math.min(p.retryCount, 4), 3600_000);
      await this.prisma.payment.update({
        where: { id: p.id },
        data: { nextPollAt: new Date(now.getTime() + delay), retryCount: { increment: 1 } },
      });
    }
    return { checked: due.length, resolved, expired };
  }

  // ------------------------------------------------------------------ US-7.5 remboursement
  async refund(actor: Actor, paymentId: string, reason: string) {
    const original = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!original) throw new DomainError('NOT_FOUND', 'Paiement introuvable');
    if (original.type !== 'DEPOSIT' || original.status !== 'COMPLETED' || !original.transactionId) {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'Seul un dépôt complété et crédité peut être remboursé',
      );
    }
    const key = `refund:${original.id}`;
    const already = await this.prisma.payment.findUnique({ where: { idempotencyKey: key } });
    if (already && already.status === 'COMPLETED') return paymentView(already);
    if (already && OPEN.includes(already.status)) throw new DomainError('IDEMPOTENCY_IN_PROGRESS');
    const now = this.clock.now();
    // 1. Blocage des fonds à rembourser (échoue si le membre les a déjà dépensés)
    const refund = await this.uow.run(
      async (tx) => {
        const r = already
          ? await tx.payment.update({
              where: { id: already.id },
              data: { status: 'PENDING', errorCode: null, errorMessage: null },
            })
          : await tx.payment.create({
              data: {
                type: 'REFUND',
                method: original.method,
                amountMinor: original.amountMinor,
                currency: original.currency,
                provider: original.provider,
                memberId: original.memberId,
                walletId: original.walletId,
                destinationMasked: original.destinationMasked,
                idempotencyKey: key,
                refundOfId: original.id,
                expiresAt: new Date(now.getTime() + PAYMENT_TTL_MS.REFUND),
                createdAt: now,
              },
            });
        const hold = await this.ledger.createHold(tx, {
          walletId: original.walletId,
          amountMinor: original.amountMinor,
          context: 'REFUND',
          referenceId: r.id,
          idempotencyKey: `refund-hold:${r.id}:${r.updatedAt.getTime()}`,
        });
        await this.history(tx, r.id, null, 'PENDING', reason);
        return tx.payment.update({ where: { id: r.id }, data: { holdId: hold.id } });
      },
      { isolationLevel: 'Serializable', retries: 5 },
    );
    // 2. Appel de l'API de remboursement du PSP
    const provider = this.registry.get(original.provider);
    try {
      if (!provider || !original.providerReference)
        throw new ProviderUnavailableError(original.provider);
      const { result } = await this.registry.call(provider, (p) =>
        p.refund({
          merchantReference: refund.id,
          originalProviderReference: original.providerReference!,
          amountMinor: original.amountMinor,
          currency: original.currency,
          reason,
        }),
      );
      await this.prisma.payment.update({
        where: { id: refund.id },
        data: { providerReference: result.providerReference, status: 'PROCESSING' },
      });
    } catch (e) {
      await this.fail(refund.id, 'PROVIDER_UNAVAILABLE', (e as Error).message);
      throw new DomainError('PROVIDER_UNAVAILABLE', 'Remboursement impossible pour le moment', {
        paymentId: refund.id,
      });
    }
    // 3. Reversement interne : capture du hold (débit membre → compensation PSP)
    const clearing = await this.wallets.ensureSystemWallet('PSP_CLEARING', original.currency);
    const t = await this.transactions.execute({
      idempotencyKey: `payment:${refund.id}`,
      type: 'REFUND',
      amountMinor: original.amountMinor,
      currency: original.currency,
      initiatorId: actor.userId,
      beneficiaryId: original.memberId,
      sourceWalletId: original.walletId,
      destinationWalletId: clearing.id,
      captureHoldId: refund.holdId,
      contextType: 'PAYMENT',
      contextId: refund.id,
      description: `Remboursement du dépôt ${original.id}`,
      lines: [
        {
          walletId: original.walletId,
          direction: 'DEBIT',
          amountMinor: original.amountMinor,
          context: 'REFUND',
          contextRef: original.id,
          description: 'Remboursement vers le moyen de paiement',
        },
        {
          walletId: clearing.id,
          direction: 'CREDIT',
          amountMinor: original.amountMinor,
          context: 'REFUND',
          contextRef: original.id,
        },
      ],
    });
    const done = await this.uow.run(async (tx) => {
      const r = await tx.payment.update({
        where: { id: refund.id },
        data: { status: 'COMPLETED', completedAt: this.clock.now(), transactionId: t.id },
      });
      await this.history(tx, r.id, 'PROCESSING', 'COMPLETED');
      await tx.payment.update({ where: { id: original.id }, data: { status: 'REFUNDED' } });
      await this.history(tx, original.id, 'COMPLETED', 'REFUNDED', reason);
      await this.outbox.add(tx, {
        type: 'payment.refunded',
        aggregateType: 'payment',
        aggregateId: original.id,
        payload: {
          paymentId: original.id,
          refundPaymentId: r.id,
          memberId: original.memberId,
          amountMinor: original.amountMinor.toString(),
          currency: original.currency,
        },
      });
      await this.audit.record(
        {
          action: 'payment.refunded',
          resourceType: 'payment',
          resourceId: original.id,
          result: 'SUCCESS',
          metadata: { reason, refundPaymentId: r.id },
        },
        tx,
      );
      return r;
    });
    return paymentView(done);
  }

  // ------------------------------------------------------------------ lecture
  async listMine(actor: Actor, limit = 50) {
    const rows = await this.prisma.payment.findMany({
      where: { memberId: actor.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => paymentView(r));
  }

  async getMine(actor: Actor, id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p || (p.memberId !== actor.userId && actor.role !== 'SUPER_ADMIN'))
      throw new DomainError('NOT_FOUND', 'Paiement introuvable');
    const history = await this.prisma.paymentStatusHistory.findMany({
      where: { paymentId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...paymentView(p),
      history: history.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        reason: h.reason,
        at: h.createdAt.toISOString(),
      })),
    };
  }

  async listAll(q: { status?: PaymentStatus; limit: number }) {
    const rows = await this.prisma.payment.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.map((r) => paymentView(r));
  }
}
