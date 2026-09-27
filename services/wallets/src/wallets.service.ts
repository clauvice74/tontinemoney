import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type WalletHistoryQuery,
  type WalletStatus,
  decodeCursor,
  encodeCursor,
  isCurrencyCode,
  moneyView,
} from '@tontine/contracts';
import { Prisma, type TxClient, type Wallet, isUniqueViolation } from '@tontine/database';
import {
  Clock,
  DomainError,
  MetricsService,
  OutboxService,
  PrismaService,
  ScheduledJob,
  TONTINE_ACCESS,
  type TontineAccessPort,
  UnitOfWork,
} from '@tontine/platform';
import { LedgerService } from './ledger.service';

export type SystemWalletCode = 'PSP_CLEARING' | 'FEES';

/** Machine à états du wallet (P2 §5.3, corrigée : SUSPENDED → CLOSED). */
const WALLET_TRANSITIONS: Record<WalletStatus, WalletStatus[]> = {
  ACTIVE: ['SUSPENDED', 'LOCKED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
  LOCKED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

export function walletView(w: Wallet) {
  return {
    id: w.id,
    currency: w.currency,
    status: w.status,
    balance: moneyView(w.balanceMinor, w.currency),
    available: moneyView(w.balanceMinor - w.blockedMinor, w.currency),
    blocked: moneyView(w.blockedMinor, w.currency),
    updatedAt: w.updatedAt.toISOString(),
  };
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    private readonly clock: Clock,
    private readonly metrics: MetricsService,
    @Inject(TONTINE_ACCESS) private readonly tontines: TontineAccessPort,
  ) {}

  /** US-5.1 — création automatique (ACID, solde 0, devise du pays, ACTIVE). Idempotente. */
  async createMemberWallet(memberId: string, currency: string | null): Promise<Wallet | null> {
    if (!currency || !isCurrencyCode(currency)) {
      this.logger.debug(`Wallet de ${memberId} différé : pays / devise inconnus`);
      return null;
    }
    const existing = await this.prisma.wallet.findUnique({ where: { memberId } });
    if (existing) return existing;
    try {
      return await this.uow.run(async (tx) => {
        const w = await tx.wallet.create({
          data: { ownerType: 'MEMBER', memberId, currency, status: 'ACTIVE' },
        });
        await this.outbox.add(tx, {
          type: 'wallet.created',
          aggregateType: 'wallet',
          aggregateId: w.id,
          payload: { walletId: w.id, memberId, currency },
        });
        return w;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return this.prisma.wallet.findUnique({ where: { memberId } });
      throw e;
    }
  }

  async ensureSystemWallet(
    code: SystemWalletCode,
    currency: string,
    db: TxClient | PrismaService = this.prisma,
  ): Promise<Wallet> {
    const found = await db.wallet.findFirst({ where: { systemCode: code, currency } });
    if (found) return found;
    try {
      return await db.wallet.create({
        data: { ownerType: 'SYSTEM', systemCode: code, currency, allowNegative: true },
      });
    } catch (e) {
      if (isUniqueViolation(e))
        return db.wallet.findFirstOrThrow({ where: { systemCode: code, currency } });
      throw e;
    }
  }

  /** Cagnotte (pool) et réserve (pénalités, droits d'entrée) d'une tontine (A-08). */
  async ensureTontineWallets(
    tx: TxClient,
    tontineId: string,
    currency: string,
  ): Promise<{ pool: Wallet; reserve: Wallet }> {
    const find = (ownerType: 'TONTINE_POOL' | 'TONTINE_RESERVE') =>
      tx.wallet.findFirst({ where: { tontineId, ownerType } });
    const pool =
      (await find('TONTINE_POOL')) ??
      (await tx.wallet.create({ data: { ownerType: 'TONTINE_POOL', tontineId, currency } }));
    const reserve =
      (await find('TONTINE_RESERVE')) ??
      (await tx.wallet.create({ data: { ownerType: 'TONTINE_RESERVE', tontineId, currency } }));
    return { pool, reserve };
  }

  async memberWallet(memberId: string): Promise<Wallet> {
    const w = await this.prisma.wallet.findUnique({ where: { memberId } });
    if (!w)
      throw new DomainError(
        'NOT_FOUND',
        'Portefeuille introuvable (profil incomplet : pays requis)',
      );
    return w;
  }

  async memberWalletOrNull(
    memberId: string,
    db: TxClient | PrismaService = this.prisma,
  ): Promise<Wallet | null> {
    return db.wallet.findUnique({ where: { memberId } });
  }

  async get(walletId: string, db: TxClient | PrismaService = this.prisma): Promise<Wallet> {
    const w = await db.wallet.findUnique({ where: { id: walletId } });
    if (!w) throw new DomainError('NOT_FOUND', 'Portefeuille introuvable');
    return w;
  }

  /** US-5.2 — historique paginé par curseur, filtres type / date / contexte, solde après opération. */
  async history(memberId: string, q: WalletHistoryQuery) {
    const wallet = await this.memberWallet(memberId);
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.WalletMovementWhereInput = {
      walletId: wallet.id,
      ...(q.type ? { type: q.type } : {}),
      ...(q.context ? { context: q.context } : {}),
      ...(q.tontineId ? { contextRef: q.tontineId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(cursor ? { seq: { lt: BigInt(String(cursor.k)) } } : {}),
    };
    const rows = await this.prisma.walletMovement.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const tontineNames = new Map<string, string>();
    for (const ref of new Set(items.map((m) => m.contextRef).filter((r): r is string => !!r))) {
      const t = await this.tontines.describe(ref).catch(() => null);
      if (t) tontineNames.set(ref, t.name);
    }
    const last = items[items.length - 1];
    return {
      data: items.map((m) => ({
        id: m.id,
        type: m.type,
        direction: m.type === 'CREDIT' ? 'IN' : m.type === 'DEBIT' ? 'OUT' : 'NEUTRAL',
        amount: moneyView(m.amountMinor, wallet.currency),
        balanceAfter: moneyView(m.balanceAfter, wallet.currency),
        availableAfter: moneyView(m.availableAfter, wallet.currency),
        context: m.context,
        contextLabel: m.contextRef ? (tontineNames.get(m.contextRef) ?? null) : null,
        contextRef: m.contextRef,
        transactionId: m.transactionId,
        description: m.description,
        createdAt: m.createdAt.toISOString(),
      })),
      page: {
        nextCursor: hasMore && last ? encodeCursor({ k: last.seq.toString(), id: last.id }) : null,
        limit: q.limit,
      },
      meta: { wallet: walletView(wallet) },
    };
  }

  /** Changement de statut avec historique (WalletStatusHistory, déclencheur tracé). */
  async setStatus(
    walletId: string,
    next: WalletStatus,
    reason: string,
    triggeredBy: string,
  ): Promise<Wallet> {
    return this.uow.run(async (tx) => {
      const w = (await this.ledger.lock(tx, [walletId])).get(walletId)!;
      const current = w.status as WalletStatus;
      if (current === next) return this.get(walletId, tx);
      if (!WALLET_TRANSITIONS[current].includes(next)) {
        throw new DomainError(
          'INVALID_STATE_TRANSITION',
          `Transition ${current} → ${next} interdite`,
        );
      }
      if (next === 'CLOSED') {
        // R-WAL-07 : fermeture uniquement si solde nul et aucun hold actif
        const activeHolds = await tx.walletHold.count({ where: { walletId, status: 'ACTIVE' } });
        if (w.balanceMinor !== 0n || activeHolds > 0) {
          throw new DomainError(
            'BUSINESS_RULE_VIOLATION',
            'Fermeture impossible : solde non nul ou blocage actif',
          );
        }
      }
      const updated = await tx.wallet.update({
        where: { id: walletId },
        data: { status: next, version: { increment: 1 } },
      });
      await tx.walletStatusHistory.create({
        data: { walletId, oldStatus: current, newStatus: next, reason, triggeredBy },
      });
      await this.outbox.add(tx, {
        type: 'wallet.status.changed',
        aggregateType: 'wallet',
        aggregateId: walletId,
        payload: { walletId, oldStatus: current, newStatus: next, reason },
      });
      return updated;
    });
  }

  /** A-12 — expiration des holds (toutes les minutes, sûr en multi-instance). */
  @ScheduledJob({
    name: 'wallets.expire-holds',
    cron: '0 * * * * *',
    description: 'Libère les blocages de fonds expirés',
  })
  async expireHolds(): Promise<{ expired: number }> {
    const now = this.clock.now();
    let expired = 0;
    for (;;) {
      const batch = await this.uow.run(
        async (tx) => {
          const due = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "wal_holds" WHERE "status" = 'ACTIVE' AND "expiresAt" <= ${now}
            ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED`;
          for (const h of due) await this.ledger.releaseHold(tx, h.id, 'EXPIRED');
          return due.length;
        },
        { isolationLevel: 'RepeatableRead', retries: 3 },
      );
      expired += batch;
      if (batch < 100) break;
    }
    if (this.metrics.enabled)
      this.metrics.activeHolds.set(
        await this.prisma.walletHold.count({ where: { status: 'ACTIVE' } }),
      );
    return { expired };
  }
}
