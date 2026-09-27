import { Injectable, Logger } from '@nestjs/common';
import {
  type SagaStatus,
  type TransactionSaga,
  type TxClient,
  isUniqueViolation,
} from '@tontine/database';
import {
  AuditService,
  Clock,
  DomainError,
  OutboxService,
  PrismaService,
  UnitOfWork,
} from '@tontine/platform';

export const SAGA_TYPES = [
  'PAYMENT_SETTLEMENT',
  'TONTINE_PAYOUT',
  'TONTINE_PAYOUT_TOPUP',
  'CONTRIBUTION',
] as const;
export type SagaType = (typeof SAGA_TYPES)[number];

/**
 * Transitions autorisées (A-53). STARTED est le seul état non terminal : une étape
 * intermédiaire change `step` sans changer `status`. Un état terminal ne bouge plus.
 */
const TRANSITIONS: Record<SagaStatus, readonly SagaStatus[]> = {
  STARTED: ['STARTED', 'COMPLETED', 'FAILED', 'COMPENSATED'],
  COMPLETED: [],
  FAILED: [],
  COMPENSATED: [],
};

export function canTransition(from: SagaStatus, to: SagaStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface SagaFailure {
  code: string;
  reason: string;
  /** Effets annulés (holds libérés, contre-passation) : statut COMPENSATED. */
  compensated: boolean;
  /** Fonds déjà sortis ou entrés chez le PSP : alerte, réconciliation manuelle. */
  requiresReconciliation: boolean;
}

/**
 * Orchestrateur de sagas de Transaction Service (étape 5, A-53) : état persistant
 * (`trx_sagas`), journal des transitions (`trx_saga_steps`), idempotence par `sagaKey`,
 * réponse au demandeur par événement (`transaction.saga.completed` / `.failed`) écrit dans
 * la même transaction SQL que l'état final.
 */
@Injectable()
export class SagaOrchestrator {
  private readonly logger = new Logger(SagaOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Démarre la saga ou retrouve celle de même clé (redélivrance, rejeu). Une saga encore
   * STARTED est reprise (tentative suivante) ; une saga terminée est renvoyée telle quelle.
   */
  async begin(
    type: SagaType,
    sagaKey: string,
    reference: string,
    request: Record<string, unknown>,
    step = 'STARTED',
  ): Promise<TransactionSaga> {
    const existing = await this.prisma.transactionSaga.findUnique({ where: { sagaKey } });
    if (existing) return existing.status === 'STARTED' ? this.retry(existing) : existing;
    try {
      return await this.uow.run(async (tx) => {
        const saga = await tx.transactionSaga.create({
          data: {
            type,
            sagaKey,
            reference,
            step,
            request: request as object,
            createdAt: this.clock.now(),
          },
        });
        await this.log(tx, saga.id, null, step, 'STARTED');
        return saga;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return this.prisma.transactionSaga.findUniqueOrThrow({ where: { sagaKey } });
    }
  }

  private async retry(saga: TransactionSaga): Promise<TransactionSaga> {
    return this.prisma.transactionSaga.update({
      where: { id: saga.id },
      data: { attempts: { increment: 1 } },
    });
  }

  /** Étape intermédiaire (la saga reste STARTED). */
  async advance(
    saga: TransactionSaga,
    step: string,
    detail?: Record<string, unknown>,
    db?: TxClient,
  ): Promise<TransactionSaga> {
    const run = async (tx: TxClient) => {
      const next = await this.move(tx, saga, 'STARTED', { step });
      await this.log(tx, saga.id, saga.step, step, 'STARTED', detail);
      return next;
    };
    return db ? run(db) : this.uow.run(run);
  }

  /** Succès : état final et réponse au demandeur dans la même transaction SQL. */
  async complete(
    saga: TransactionSaga,
    transactionId: string,
    db?: TxClient,
  ): Promise<TransactionSaga> {
    const run = async (tx: TxClient) => {
      const done = await this.move(tx, saga, 'COMPLETED', {
        step: 'COMPLETED',
        transactionId,
        completedAt: this.clock.now(),
      });
      await this.log(tx, saga.id, saga.step, 'COMPLETED', 'COMPLETED', { transactionId });
      await this.outbox.add(tx, {
        type: 'transaction.saga.completed',
        aggregateType: 'saga',
        aggregateId: saga.id,
        payload: { sagaId: saga.id, sagaType: saga.type, reference: saga.reference, transactionId },
      });
      return done;
    };
    return db ? run(db) : this.uow.run(run);
  }

  /** Échec : FAILED ou COMPENSATED ; alerte d'audit si une réconciliation est requise. */
  async fail(saga: TransactionSaga, f: SagaFailure, db?: TxClient): Promise<TransactionSaga> {
    const status: SagaStatus = f.compensated ? 'COMPENSATED' : 'FAILED';
    const reason = f.reason.slice(0, 500);
    const run = async (tx: TxClient) => {
      const done = await this.move(tx, saga, status, {
        step: status,
        failureCode: f.code,
        failureReason: reason,
        completedAt: this.clock.now(),
      });
      await this.log(tx, saga.id, saga.step, status, status, {
        code: f.code,
        reason,
        requiresReconciliation: f.requiresReconciliation,
      });
      await this.outbox.add(tx, {
        type: 'transaction.saga.failed',
        aggregateType: 'saga',
        aggregateId: saga.id,
        payload: {
          sagaId: saga.id,
          sagaType: saga.type,
          reference: saga.reference,
          failureCode: f.code,
          failureReason: reason,
          compensated: f.compensated,
          requiresReconciliation: f.requiresReconciliation,
        },
      });
      if (f.requiresReconciliation)
        await this.audit.record(
          {
            action: 'transaction.saga.reconciliation_required',
            resourceType: 'saga',
            resourceId: saga.id,
            result: 'FAILURE',
            metadata: { type: saga.type, reference: saga.reference, code: f.code, reason },
          },
          tx,
        );
      return done;
    };
    const done = await (db ? run(db) : this.uow.run(run));
    this.logger.warn(`Saga ${saga.type} ${saga.id} : ${status} (${f.code})`);
    return done;
  }

  /** Transition gardée : la mise à jour n'aboutit que si l'état lu est toujours STARTED. */
  private async move(
    tx: TxClient,
    saga: TransactionSaga,
    to: SagaStatus,
    data: Partial<
      Pick<
        TransactionSaga,
        'step' | 'transactionId' | 'failureCode' | 'failureReason' | 'completedAt'
      >
    >,
  ): Promise<TransactionSaga> {
    if (!canTransition(saga.status, to))
      throw new DomainError('INVALID_STATE_TRANSITION', `Saga ${saga.status} → ${to}`);
    const res = await tx.transactionSaga.updateMany({
      where: { id: saga.id, status: 'STARTED' },
      data: { ...data, status: to },
    });
    if (res.count !== 1)
      throw new DomainError('INVALID_STATE_TRANSITION', 'Saga déjà terminée', { sagaId: saga.id });
    return tx.transactionSaga.findUniqueOrThrow({ where: { id: saga.id } });
  }

  private async log(
    tx: TxClient,
    sagaId: string,
    fromStep: string | null,
    toStep: string,
    status: SagaStatus,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await tx.transactionSagaStep.create({
      data: {
        sagaId,
        fromStep,
        toStep,
        status,
        detail: (detail ?? undefined) as object | undefined,
        createdAt: this.clock.now(),
      },
    });
  }
}
