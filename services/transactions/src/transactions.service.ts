import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type KycLevel,
  type OperationType,
  type TransactionContextType,
  type TransactionType,
  moneyView,
} from '@tontine/contracts';
import { ComplianceService } from '@tontine/compliance';
import { type Transaction, type TxClient } from '@tontine/database';
import {
  type Actor,
  Clock,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  RequestContext,
  UnitOfWork,
  kycAtLeast,
} from '@tontine/platform';
import { LedgerService, type PostingLine } from '@tontine/wallets';
import { FraudScoringPort } from './fraud-scoring';

export const AUDIT_RETENTION_MS = 7 * 365 * 86_400_000; // US-6.5 : conservation 7 ans

export interface ExecuteInput {
  idempotencyKey: string;
  type: TransactionType;
  amountMinor: bigint;
  currency: string;
  initiatorId: string | null;
  beneficiaryId: string | null;
  sourceWalletId: string | null;
  destinationWalletId: string | null;
  lines: PostingLine[];
  contextType: TransactionContextType;
  contextId?: string | null;
  description?: string | null;
  captureHoldId?: string | null;
  reversalOfId?: string | null;
  /** Contrôle d'éligibilité du membre à l'origine de l'opération (R-MBR-02, R-KYC-01). */
  eligibility?: { memberId: string; minKyc: KycLevel } | null;
  /** Validation de conformité (R-CMP-01). */
  compliance?: { operationType: OperationType; memberId: string; creditMemberId?: string | null } | null;
  /** Scoring fraude (R-TRX-03). */
  fraudCheck?: boolean;
  metadata?: Record<string, unknown>;
}

export function transactionView(t: Transaction) {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    amount: moneyView(t.amountMinor, t.currency),
    initiatorId: t.initiatorId,
    beneficiaryId: t.beneficiaryId,
    contextType: t.contextType,
    contextId: t.contextId,
    description: t.description,
    rejectionRule: t.rejectionRule,
    rejectionReason: t.rejectionReason,
    failureCode: t.failureCode,
    failureReason: t.failureReason,
    reversalOfId: t.reversalOfId,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}

/**
 * Pipeline des transactions (épique 6) : initiation (idempotente) → validation (solde, KYC,
 * conformité, fraude, cohérence) → exécution ACID SERIALIZABLE → post-traitement (audit, événements).
 */
@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService,
    private readonly fraud: FraudScoringPort,
    private readonly clock: Clock,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  /** US-6.5 — journal immuable : IP, device, User-Agent, pays, action, résultat. */
  async audit(db: TxClient | PrismaService, txId: string, action: string, result: string, details: Record<string, unknown> = {}): Promise<void> {
    const ctx = RequestContext.current();
    await db.transactionAuditLog.create({
      data: {
        transactionId: txId,
        action,
        result,
        actorId: ctx?.actor?.userId ?? null,
        ip: ctx?.ip ?? null,
        device: ctx?.userAgent ? ctx.userAgent.slice(0, 100) : ctx?.source ?? null,
        userAgent: ctx?.userAgent?.slice(0, 255) ?? null,
        country: ctx?.country ?? null,
        details: details as object,
        retainUntil: new Date(this.clock.now().getTime() + AUDIT_RETENTION_MS),
        createdAt: this.clock.now(),
      },
    });
  }

  private async reject(t: Transaction, rule: string, reason: string, code: 'INSUFFICIENT_FUNDS' | 'COMPLIANCE_VIOLATION' | 'KYC_LEVEL_INSUFFICIENT' | 'MEMBER_NOT_ELIGIBLE' | 'BUSINESS_RULE_VIOLATION' | 'CURRENCY_MISMATCH' | 'WALLET_NOT_OPERATIONAL', extra: Record<string, unknown> = {}): Promise<never> {
    await this.uow.run(async (tx) => {
      await tx.transaction.update({ where: { id: t.id }, data: { status: 'REJECTED', rejectionRule: rule, rejectionReason: reason } });
      await this.audit(tx, t.id, 'VALIDATION', 'REJECTED', { rule, reason });
      await this.outbox.add(tx, {
        type: 'transaction.rejected',
        aggregateType: 'transaction',
        aggregateId: t.id,
        payload: { txId: t.id, initiatorId: t.initiatorId, rejectionRule: rule, rejectionReason: reason },
      });
      if (code === 'INSUFFICIENT_FUNDS' && t.sourceWalletId) {
        const w = await tx.wallet.findUnique({ where: { id: t.sourceWalletId }, select: { memberId: true } });
        await this.outbox.add(tx, {
          type: 'wallet.debit.failed',
          aggregateType: 'wallet',
          aggregateId: t.sourceWalletId,
          payload: { walletId: t.sourceWalletId, memberId: w?.memberId ?? null, reason: 'INSUFFICIENT_FUNDS', requestedMinor: t.amountMinor.toString() },
        });
      }
    });
    throw new DomainError(code, reason, { transactionId: t.id, rule, ...extra });
  }

  /** Exécute une transaction de bout en bout. Idempotente par `idempotencyKey` (R-TRX-01). */
  async execute(input: ExecuteInput): Promise<Transaction> {
    if (input.amountMinor <= 0n) throw new DomainError('VALIDATION_FAILED', 'Montant invalide');
    const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.status === 'COMPLETED' || existing.status === 'REVERSED') return existing;
      if (existing.status === 'REJECTED' || existing.status === 'FAILED') {
        throw new DomainError(existing.status === 'REJECTED' ? 'BUSINESS_RULE_VIOLATION' : 'CONFLICT', existing.rejectionReason ?? existing.failureReason ?? 'Transaction déjà traitée', { transactionId: existing.id });
      }
      throw new DomainError('IDEMPOTENCY_IN_PROGRESS');
    }

    // 1. INITIATION
    const meta = RequestContext.metadata();
    const t = await this.uow.run(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          type: input.type,
          status: 'PENDING',
          amountMinor: input.amountMinor,
          currency: input.currency,
          initiatorId: input.initiatorId,
          beneficiaryId: input.beneficiaryId,
          sourceWalletId: input.sourceWalletId,
          destinationWalletId: input.destinationWalletId,
          holdId: input.captureHoldId ?? null,
          contextType: input.contextType,
          contextId: input.contextId ?? null,
          description: input.description ?? null,
          reversalOfId: input.reversalOfId ?? null,
          // R-TRX-07 : métadonnées d'audit obligatoires
          metadata: { ip: meta.ip, device: meta.userAgent, country: meta.country, correlationId: meta.correlationId, source: RequestContext.current()?.source ?? 'system', ...(input.metadata ?? {}) } as object,
          createdAt: this.clock.now(),
        },
      });
      await this.audit(tx, created.id, 'INITIATED', 'PENDING', { type: input.type, amountMinor: input.amountMinor.toString() });
      await this.outbox.add(tx, {
        type: 'transaction.initiated',
        aggregateType: 'transaction',
        aggregateId: created.id,
        payload: {
          txId: created.id,
          type: created.type,
          amountMinor: created.amountMinor.toString(),
          currency: created.currency,
          initiatorId: created.initiatorId,
          beneficiaryId: created.beneficiaryId,
          contextType: created.contextType,
          contextId: created.contextId,
        },
      });
      return created;
    });

    // 2. VALIDATION (US-6.2)
    if (input.eligibility) {
      const m = await this.members.snapshot(input.eligibility.memberId);
      if (!m || m.status === 'SUSPENDED' || m.status === 'PENDING_REVIEW') {
        await this.reject(t, 'MEMBER-SUSPENDED', 'Compte suspendu ou en revue : aucune opération possible', 'MEMBER_NOT_ELIGIBLE');
      } else if (!kycAtLeast(m.kycLevel, input.eligibility.minKyc)) {
        await this.reject(t, 'KYC-LEVEL', `Vérification d’identité requise (niveau ${input.eligibility.minKyc})`, 'KYC_LEVEL_INSUFFICIENT');
      }
    }
    if (input.compliance) {
      try {
        await this.compliance.assertCompliant({
          operationType: input.compliance.operationType,
          memberId: input.compliance.memberId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          creditMemberId: input.compliance.creditMemberId ?? null,
          context: { transactionId: t.id, contextId: input.contextId ?? null },
        });
      } catch (e) {
        if (e instanceof DomainError && e.code === 'COMPLIANCE_VIOLATION') {
          const first = (e.extra['violations'] as Array<{ rule: string }> | undefined)?.[0]?.rule ?? 'COMPLIANCE';
          await this.reject(t, first, e.message, 'COMPLIANCE_VIOLATION', { violations: e.extra['violations'] });
        }
        throw e;
      }
    }
    if (input.fraudCheck) {
      const score = await this.fraud.score({ memberId: input.initiatorId, type: input.type, amountMinor: input.amountMinor, currency: input.currency });
      if (score.score >= this.fraud.threshold) {
        // R-TRX-03 : bloquée par le scoring fraude → REJECTED avec alerte
        this.logger.warn(`Transaction ${t.id} bloquée par le scoring fraude (${score.score})`);
        await this.reject(t, 'FRAUD-SCORE', `Opération bloquée par le contrôle anti-fraude (${score.reason})`, 'BUSINESS_RULE_VIOLATION');
      }
    }
    if (input.sourceWalletId && !input.captureHoldId) {
      const w = await this.prisma.wallet.findUnique({ where: { id: input.sourceWalletId } });
      if (w && !w.allowNegative && w.balanceMinor - w.blockedMinor < input.amountMinor) {
        await this.reject(t, 'BALANCE', 'Le solde disponible est insuffisant pour cette opération', 'INSUFFICIENT_FUNDS', {
          availableMinor: (w.balanceMinor - w.blockedMinor).toString(),
        });
      }
    }

    // 3. EXÉCUTION ACID (US-6.3, R-TRX-05)
    try {
      return await this.uow.run(
        async (tx) => {
          await tx.transaction.update({ where: { id: t.id }, data: { status: 'VALIDATED', validatedAt: this.clock.now() } });
          await this.outbox.add(tx, { type: 'transaction.validated', aggregateType: 'transaction', aggregateId: t.id, payload: { txId: t.id } });
          const movements = await this.ledger.post(tx, {
            transactionId: t.id,
            currency: input.currency,
            lines: input.lines,
            captureHoldId: input.captureHoldId ?? null,
          });
          const done = await tx.transaction.update({ where: { id: t.id }, data: { status: 'COMPLETED', completedAt: this.clock.now() } });
          await this.audit(tx, t.id, 'EXECUTED', 'COMPLETED', { movements: movements.length });
          await this.outbox.add(tx, {
            type: 'transaction.completed',
            aggregateType: 'transaction',
            aggregateId: t.id,
            payload: { txId: t.id, type: done.type, completedAt: done.completedAt!.toISOString(), movementIds: movements.map((m) => m.id) },
          });
          return done;
        },
        { isolationLevel: 'Serializable', retries: 5 },
      );
    } catch (e) {
      const code = e instanceof DomainError ? e.code : 'TECHNICAL_ERROR';
      const reason = e instanceof Error ? e.message : String(e);
      // ROLLBACK effectué : la transaction passe en FAILED (aucun mouvement n'a été écrit)
      await this.uow.run(async (tx) => {
        await tx.transaction.update({ where: { id: t.id }, data: { status: 'FAILED', failureCode: code, failureReason: reason.slice(0, 500) } });
        await this.audit(tx, t.id, 'EXECUTION', 'FAILED', { code, reason: reason.slice(0, 500) });
        await this.outbox.add(tx, {
          type: 'transaction.failed',
          aggregateType: 'transaction',
          aggregateId: t.id,
          payload: { txId: t.id, initiatorId: t.initiatorId, failureCode: code, failureReason: reason.slice(0, 500) },
        });
      });
      throw e;
    }
  }

  /**
   * US-6.4 — compensation : contre-passation exacte d'une transaction COMPLETED (nouvelle
   * transaction REVERSAL), l'originale passe en REVERSED. Idempotente.
   */
  async reverse(txId: string, reason: string, actorId: string | null = null): Promise<Transaction> {
    const original = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!original) throw new DomainError('NOT_FOUND', 'Transaction introuvable');
    const already = await this.prisma.transaction.findUnique({ where: { reversalOfId: txId } });
    if (already?.status === 'COMPLETED') return already;
    if (original.status !== 'COMPLETED') throw new DomainError('INVALID_STATE_TRANSITION', `Transaction ${original.status} : annulation impossible`);
    const movements = await this.prisma.walletMovement.findMany({ where: { transactionId: txId, type: { in: ['CREDIT', 'DEBIT'] } } });
    const lines: PostingLine[] = movements.map((m) => ({
      walletId: m.walletId,
      direction: m.type === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      amountMinor: m.amountMinor,
      context: 'REVERSAL',
      contextRef: m.contextRef,
      description: `Annulation : ${reason}`.slice(0, 200),
    }));
    const reversal = await this.execute({
      idempotencyKey: `reversal:${txId}`,
      type: 'REVERSAL',
      amountMinor: original.amountMinor,
      currency: original.currency,
      initiatorId: actorId ?? original.initiatorId,
      beneficiaryId: original.initiatorId,
      sourceWalletId: original.destinationWalletId,
      destinationWalletId: original.sourceWalletId,
      lines,
      contextType: original.contextType,
      contextId: original.contextId,
      description: `Annulation de ${txId} : ${reason}`,
      reversalOfId: txId,
    });
    await this.uow.run(async (tx) => {
      const res = await tx.transaction.updateMany({ where: { id: txId, status: 'COMPLETED' }, data: { status: 'REVERSED' } });
      if (res.count !== 1) return;
      await this.audit(tx, txId, 'REVERSED', 'REVERSED', { reversalTxId: reversal.id, reason });
      await this.outbox.add(tx, {
        type: 'transaction.reversed',
        aggregateType: 'transaction',
        aggregateId: txId,
        payload: { txId, reversalTxId: reversal.id, reason, initiatorId: original.initiatorId },
      });
    });
    return reversal;
  }

  async getForActor(actor: Actor, id: string): Promise<Transaction> {
    const t = await this.prisma.transaction.findUnique({ where: { id } });
    if (!t || (actor.role !== 'SUPER_ADMIN' && t.initiatorId !== actor.userId && t.beneficiaryId !== actor.userId)) {
      throw new DomainError('NOT_FOUND', 'Transaction introuvable');
    }
    return t;
  }
}
