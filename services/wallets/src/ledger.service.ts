import { Injectable } from '@nestjs/common';
import { type MovementContext } from '@tontine/contracts';
import {
  Prisma,
  type TxClient,
  type Wallet,
  type WalletHold,
  type WalletMovement,
} from '@tontine/database';
import { Clock, DomainError, OutboxService } from '@tontine/platform';

export interface PostingLine {
  walletId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
  context: MovementContext;
  contextRef?: string | null;
  description?: string | null;
}

export interface PostInput {
  transactionId: string;
  currency: string;
  lines: PostingLine[];
  /** Hold à capturer : son montant est d'abord libéré puis débité (US-5.5 §5). */
  captureHoldId?: string | null;
}

export interface HoldInput {
  walletId: string;
  amountMinor: bigint;
  context: MovementContext;
  referenceId?: string | null;
  idempotencyKey: string;
  ttlSeconds?: number;
}

/** TTL des holds par contexte (A-12). */
export const HOLD_TTL_SECONDS: Partial<Record<MovementContext, number>> = {
  TONTINE_CONTRIBUTION: 15 * 60,
  TRANSFER: 60 * 60,
  WITHDRAWAL: 24 * 3600,
};
const DEFAULT_HOLD_TTL = 24 * 3600;

type LockedWallet = Pick<
  Wallet,
  | 'id'
  | 'ownerType'
  | 'memberId'
  | 'currency'
  | 'balanceMinor'
  | 'blockedMinor'
  | 'allowNegative'
  | 'status'
  | 'version'
>;

/**
 * Grand livre en partie double (docs/domain-model.md §3). Seul point d'écriture des soldes.
 * DOIT être appelé dans une transaction SERIALIZABLE (UnitOfWork) : verrous ordonnés par identifiant
 * pour éliminer les interblocages, contrôles de statut / devise / solde, écritures immuables,
 * événements dans l'outbox.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  /** Verrouille les wallets par ordre d'identifiant croissant (anti-deadlock, P2 §5 notes). */
  async lock(tx: TxClient, walletIds: string[]): Promise<Map<string, LockedWallet>> {
    const ids = [...new Set(walletIds)].sort();
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<LockedWallet[]>`
      SELECT "id", "ownerType"::text AS "ownerType", "memberId", "currency", "balanceMinor", "blockedMinor",
             "allowNegative", "status"::text AS "status", "version"
      FROM "wal_wallets" WHERE "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id" FOR UPDATE`;
    if (rows.length !== ids.length) throw new DomainError('NOT_FOUND', 'Portefeuille introuvable');
    return new Map(rows.map((r) => [r.id, r]));
  }

  async post(tx: TxClient, input: PostInput): Promise<WalletMovement[]> {
    if (input.lines.length < 2) throw new Error('Une écriture comporte au moins deux lignes');
    let debit = 0n;
    let credit = 0n;
    for (const l of input.lines) {
      if (l.amountMinor <= 0n)
        throw new DomainError('VALIDATION_FAILED', 'Montant d’écriture invalide');
      if (l.direction === 'DEBIT') debit += l.amountMinor;
      else credit += l.amountMinor;
    }
    // Invariant partie double : Σ débits = Σ crédits
    if (debit !== credit) throw new Error(`Écriture déséquilibrée (${debit} ≠ ${credit})`);

    const wallets = await this.lock(
      tx,
      input.lines.map((l) => l.walletId),
    );
    let hold: WalletHold | null = null;
    if (input.captureHoldId) {
      hold = await tx.walletHold.findUnique({ where: { id: input.captureHoldId } });
      if (!hold || hold.status !== 'ACTIVE') {
        throw new DomainError('INVALID_STATE_TRANSITION', 'Le blocage de fonds n’est plus actif');
      }
    }

    // Soldes de travail
    const state = new Map(
      [...wallets.values()].map((w) => [
        w.id,
        { balance: w.balanceMinor, blocked: w.blockedMinor },
      ]),
    );
    const movements: Prisma.WalletMovementCreateManyInput[] = [];
    const now = this.clock.now();

    if (hold) {
      const w = wallets.get(hold.walletId);
      const s = state.get(hold.walletId);
      if (!w || !s) throw new Error('Le hold à capturer ne concerne pas cette écriture');
      s.blocked -= hold.amountMinor;
      movements.push({
        walletId: w.id,
        transactionId: input.transactionId,
        holdId: hold.id,
        type: 'RELEASE',
        amountMinor: hold.amountMinor,
        balanceAfter: s.balance,
        availableAfter: s.balance - s.blocked,
        context: hold.context,
        contextRef: hold.referenceId,
        description: 'Capture du blocage',
        createdAt: now,
      });
    }

    for (const line of input.lines) {
      const w = wallets.get(line.walletId);
      const s = state.get(line.walletId);
      if (!w || !s) throw new Error('Portefeuille non verrouillé');
      if (w.currency !== input.currency)
        throw new DomainError('CURRENCY_MISMATCH', `Devise ${w.currency} ≠ ${input.currency}`);
      if (line.direction === 'DEBIT') {
        // R-WAL-03 / R-WAL-04 : un wallet suspendu, verrouillé ou fermé ne peut pas être débité.
        if (w.status !== 'ACTIVE') {
          throw new DomainError(
            'WALLET_NOT_OPERATIONAL',
            `Portefeuille ${w.status.toLowerCase()} : débit impossible`,
            { walletStatus: w.status },
          );
        }
        const available = s.balance - s.blocked;
        if (!w.allowNegative && available < line.amountMinor) {
          throw new DomainError(
            'INSUFFICIENT_FUNDS',
            'Le solde disponible est insuffisant pour cette opération',
            {
              availableMinor: available.toString(),
              requestedMinor: line.amountMinor.toString(),
            },
          );
        }
        s.balance -= line.amountMinor;
      } else {
        if (w.status === 'LOCKED' || w.status === 'CLOSED') {
          throw new DomainError(
            'WALLET_NOT_OPERATIONAL',
            `Portefeuille ${w.status.toLowerCase()} : aucune opération possible`,
            { walletStatus: w.status },
          );
        }
        s.balance += line.amountMinor;
      }
      movements.push({
        walletId: w.id,
        transactionId: input.transactionId,
        holdId: line.direction === 'DEBIT' && hold?.walletId === w.id ? hold.id : null,
        type: line.direction,
        amountMinor: line.amountMinor,
        balanceAfter: s.balance,
        availableAfter: s.balance - s.blocked,
        context: line.context,
        contextRef: line.contextRef ?? null,
        description: line.description ?? null,
        createdAt: now,
      });
    }

    for (const [id, s] of state) {
      const w = wallets.get(id)!;
      if (s.balance === w.balanceMinor && s.blocked === w.blockedMinor) continue;
      const res = await tx.wallet.updateMany({
        where: { id, version: w.version },
        data: { balanceMinor: s.balance, blockedMinor: s.blocked, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new DomainError('CONFLICT', 'Portefeuille modifié simultanément');
    }
    if (hold) {
      await tx.walletHold.update({
        where: { id: hold.id },
        data: { status: 'CAPTURED', resolvedAt: now },
      });
    }

    const created: WalletMovement[] = [];
    for (const m of movements) created.push(await tx.walletMovement.create({ data: m }));

    // Événements (R-WAL-05) : un wallet.balance.updated par ligne mouvementant le solde
    for (const m of created) {
      if (m.type !== 'CREDIT' && m.type !== 'DEBIT') continue;
      const w = wallets.get(m.walletId)!;
      const old =
        m.type === 'CREDIT' ? m.balanceAfter - m.amountMinor : m.balanceAfter + m.amountMinor;
      await this.outbox.add(tx, {
        type: 'wallet.balance.updated',
        aggregateType: 'wallet',
        aggregateId: w.id,
        payload: {
          walletId: w.id,
          memberId: w.memberId,
          oldBalanceMinor: old.toString(),
          newBalanceMinor: m.balanceAfter.toString(),
          movementType: m.type,
          amountMinor: m.amountMinor.toString(),
          currency: w.currency,
          context: m.context,
          transactionId: input.transactionId,
        },
      });
    }
    if (hold) {
      await this.outbox.add(tx, {
        type: 'wallet.hold.released',
        aggregateType: 'wallet',
        aggregateId: hold.walletId,
        payload: {
          walletId: hold.walletId,
          holdId: hold.id,
          amountMinor: hold.amountMinor.toString(),
          outcome: 'CAPTURED',
        },
      });
    }
    return created;
  }

  /** US-5.5 — blocage de fonds : `blocked += montant` si `balance − blocked ≥ montant`. Idempotent par clé. */
  async createHold(tx: TxClient, input: HoldInput): Promise<WalletHold> {
    const existing = await tx.walletHold.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    if (input.amountMinor <= 0n) throw new DomainError('VALIDATION_FAILED', 'Montant invalide');
    const w = (await this.lock(tx, [input.walletId])).get(input.walletId)!;
    if (w.status !== 'ACTIVE') {
      throw new DomainError(
        'WALLET_NOT_OPERATIONAL',
        `Portefeuille ${w.status.toLowerCase()} : blocage impossible`,
        { walletStatus: w.status },
      );
    }
    const available = w.balanceMinor - w.blockedMinor;
    if (available < input.amountMinor) {
      throw new DomainError(
        'INSUFFICIENT_FUNDS',
        'Le solde disponible est insuffisant pour cette opération',
        {
          availableMinor: available.toString(),
          requestedMinor: input.amountMinor.toString(),
        },
      );
    }
    const now = this.clock.now();
    const ttl = input.ttlSeconds ?? HOLD_TTL_SECONDS[input.context] ?? DEFAULT_HOLD_TTL;
    const hold = await tx.walletHold.create({
      data: {
        walletId: w.id,
        amountMinor: input.amountMinor,
        context: input.context,
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(now.getTime() + ttl * 1000),
      },
    });
    const blocked = w.blockedMinor + input.amountMinor;
    await tx.wallet.update({
      where: { id: w.id },
      data: { blockedMinor: blocked, version: { increment: 1 } },
    });
    await tx.walletMovement.create({
      data: {
        walletId: w.id,
        holdId: hold.id,
        type: 'HOLD',
        amountMinor: input.amountMinor,
        balanceAfter: w.balanceMinor,
        availableAfter: w.balanceMinor - blocked,
        context: input.context,
        contextRef: input.referenceId ?? null,
        description: 'Blocage de fonds',
        createdAt: now,
      },
    });
    await this.outbox.add(tx, {
      type: 'wallet.hold.created',
      aggregateType: 'wallet',
      aggregateId: w.id,
      payload: {
        walletId: w.id,
        holdId: hold.id,
        amountMinor: input.amountMinor.toString(),
        context: input.context,
        referenceId: input.referenceId ?? null,
      },
    });
    return hold;
  }

  /** Annulation (ou expiration) d'un hold : `blocked −= montant`. Idempotent. */
  async releaseHold(
    tx: TxClient,
    holdId: string,
    outcome: 'RELEASED' | 'EXPIRED' = 'RELEASED',
  ): Promise<WalletHold | null> {
    const hold = await tx.walletHold.findUnique({ where: { id: holdId } });
    if (!hold || hold.status !== 'ACTIVE') return hold;
    const w = (await this.lock(tx, [hold.walletId])).get(hold.walletId)!;
    const now = this.clock.now();
    const blocked = w.blockedMinor - hold.amountMinor;
    await tx.wallet.update({
      where: { id: w.id },
      data: { blockedMinor: blocked, version: { increment: 1 } },
    });
    const updated = await tx.walletHold.update({
      where: { id: hold.id },
      data: { status: outcome, resolvedAt: now },
    });
    await tx.walletMovement.create({
      data: {
        walletId: w.id,
        holdId: hold.id,
        type: 'RELEASE',
        amountMinor: hold.amountMinor,
        balanceAfter: w.balanceMinor,
        availableAfter: w.balanceMinor - blocked,
        context: hold.context,
        contextRef: hold.referenceId,
        description: outcome === 'EXPIRED' ? 'Expiration du blocage' : 'Annulation du blocage',
        createdAt: now,
      },
    });
    await this.outbox.add(
      tx,
      outcome === 'EXPIRED'
        ? {
            type: 'wallet.hold.expired',
            aggregateType: 'wallet',
            aggregateId: w.id,
            payload: {
              walletId: w.id,
              holdId: hold.id,
              amountMinor: hold.amountMinor.toString(),
              context: hold.context,
              referenceId: hold.referenceId,
            },
          }
        : {
            type: 'wallet.hold.released',
            aggregateType: 'wallet',
            aggregateId: w.id,
            payload: {
              walletId: w.id,
              holdId: hold.id,
              amountMinor: hold.amountMinor.toString(),
              outcome: 'RELEASED',
            },
          },
    );
    return updated;
  }
}
