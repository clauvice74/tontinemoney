import { Inject, Injectable } from '@nestjs/common';
import { ComplianceService } from '@tontine/compliance';
import {
  type CreateTontineInput,
  type UpdateTontineInput,
  fromMinor,
  getCountry,
  moneyView,
  percentToBps,
  toMinor,
} from '@tontine/contracts';
import {
  type Tontine,
  type TontineMember,
  type TxClient,
  isUniqueViolation,
} from '@tontine/database';
import {
  ADMIN_DELEGATION,
  type Actor,
  type AdminDelegationPort,
  AuditService,
  Clock,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  UnitOfWork,
  kycAtLeast,
} from '@tontine/platform';
import { WalletsService } from '@tontine/wallets';
import { addDays, localDate } from './domain/calendar';

/** Comparaison JSON de valeurs Prisma (bigint compris). */
const jsonBigint = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** US-4.1 §2 : date de début ≥ aujourd'hui + 7 jours. */
export const MIN_START_DELAY_DAYS = 7;
/** US-4.3 : minimum de participants pour démarrer (et passer READY, A-05). */
export const MIN_MEMBERS = 3;
/** Adhésions comptées dans la capacité (maxMembers). */
export const SEATED_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION'] as const;
/** Adhésions donnant accès en lecture à la tontine. */
export const VISIBLE_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION'] as const;

/** Résumé du cycle en cours (liste et détail des tontines, refonte lot 3). */
export interface CurrentCycleSummary {
  number: number;
  status: string;
  dueDate: string;
  beneficiary: { memberId: string; firstName: string } | null;
  paidCount: number;
  memberCount: number;
}

export function tontineView(
  t: Tontine,
  extra: {
    memberCount: number;
    myRole?: string | null;
    myStatus?: string | null;
    currentCycle?: CurrentCycleSummary | null;
  },
) {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    contribution: moneyView(t.contributionMinor, t.currency),
    currency: t.currency,
    frequency: t.frequency,
    frequencyDetail: t.frequencyDetail,
    maxMembers: t.maxMembers,
    memberCount: extra.memberCount,
    startDate: t.startDate.toISOString().slice(0, 10),
    timezone: t.timezone,
    drawMode: t.drawMode,
    penaltyRules: {
      graceDays: t.graceDays,
      lateFeePercent: t.lateFeeBps / 100,
      suspendAfter: t.suspendAfter,
      defaultAfterDays: t.defaultAfterDays,
    },
    entryFee: t.entryFeeMinor > 0n ? moneyView(t.entryFeeMinor, t.currency) : null,
    collation: t.collationMinor > 0n ? moneyView(t.collationMinor, t.currency) : null,
    incompletePolicy: t.incompletePolicy,
    currentCycleNumber: t.currentCycleNumber,
    totalCycles: t.totalCycles,
    createdById: t.createdById,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    pausedReason: t.pausedReason,
    myRole: extra.myRole ?? null,
    myStatus: extra.myStatus ?? null,
    currentCycle: extra.currentCycle ?? null,
    version: t.version,
  };
}

/** Création, consultation et cycle de vie « avant démarrage » des tontines (US-4.1, A-04, A-05). */
@Injectable()
export class TontinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly wallets: WalletsService,
    private readonly compliance: ComplianceService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
    @Inject(ADMIN_DELEGATION) private readonly delegation: AdminDelegationPort,
  ) {}

  // ------------------------------------------------------------------ accès
  async membership(tontineId: string, userId: string): Promise<TontineMember | null> {
    return this.prisma.tontineMember.findUnique({
      where: { tontineId_memberId: { tontineId, memberId: userId } },
    });
  }

  /** Tontine visible par l'acteur (participant ou super-admin) ; 404 sinon (pas d'énumération). */
  async getVisible(
    actor: Actor,
    tontineId: string,
  ): Promise<{ tontine: Tontine; membership: TontineMember | null }> {
    const tontine = await this.prisma.tontine.findUnique({ where: { id: tontineId } });
    if (!tontine) throw new DomainError('NOT_FOUND', 'Tontine introuvable');
    const membership = await this.membership(tontineId, actor.userId);
    const visible =
      !!membership && (VISIBLE_STATUSES as readonly string[]).includes(membership.status);
    if (!visible && actor.role !== 'SUPER_ADMIN')
      throw new DomainError('NOT_FOUND', 'Tontine introuvable');
    return { tontine, membership };
  }

  /** Contrôle de propriété : admin de CETTE tontine (A-23) ou super-admin. */
  async getAdministered(actor: Actor, tontineId: string, allowSuperAdmin = true): Promise<Tontine> {
    const { tontine, membership } = await this.getVisible(actor, tontineId);
    const isAdmin =
      membership?.role === 'ADMIN' &&
      (membership.status === 'ACTIVE' || membership.status === 'PENDING_ACTIVATION');
    if (!isAdmin && !(allowSuperAdmin && actor.role === 'SUPER_ADMIN')) {
      throw new DomainError('FORBIDDEN', 'Action réservée à l’administrateur de la tontine');
    }
    return tontine;
  }

  async seatedCount(
    tontineId: string,
    db: TxClient | PrismaService = this.prisma,
  ): Promise<number> {
    return db.tontineMember.count({ where: { tontineId, status: { in: [...SEATED_STATUSES] } } });
  }

  async view(actor: Actor, tontineId: string) {
    const { tontine, membership } = await this.getVisible(actor, tontineId);
    const current = await this.currentCycles([tontine]);
    return tontineView(tontine, {
      memberCount: await this.seatedCount(tontineId),
      myRole: membership?.role ?? null,
      myStatus: membership?.status ?? null,
      currentCycle: current.get(tontine.id) ?? null,
    });
  }

  /**
   * Cycle en cours de chaque tontine (numéro courant) : échéance, bénéficiaire (prénom),
   * contributions reçues. Une requête pour toutes les tontines, une pour les prénoms.
   */
  async currentCycles(tontines: Tontine[]): Promise<Map<string, CurrentCycleSummary>> {
    const pairs = tontines
      .filter((t) => t.currentCycleNumber !== null)
      .map((t) => ({ tontineId: t.id, number: t.currentCycleNumber! }));
    if (pairs.length === 0) return new Map();
    const cycles = await this.prisma.tontineCycle.findMany({
      where: { OR: pairs },
      include: { contributions: { select: { status: true } } },
    });
    const names = new Map(
      (
        await this.members.snapshots(
          cycles.flatMap((c) => (c.beneficiaryId ? [c.beneficiaryId] : [])),
        )
      ).map((m) => [m.id, m.firstName]),
    );
    return new Map(
      cycles.map((c) => [
        c.tontineId,
        {
          number: c.number,
          status: c.status,
          dueDate: c.dueDate.toISOString().slice(0, 10),
          beneficiary: c.beneficiaryId
            ? { memberId: c.beneficiaryId, firstName: names.get(c.beneficiaryId) ?? '—' }
            : null,
          paidCount: c.contributions.filter((x) => x.status === 'PAID' || x.status === 'PAID_LATE')
            .length,
          memberCount: c.contributions.length,
        },
      ]),
    );
  }

  async listMine(actor: Actor) {
    const rows = await this.prisma.tontineMember.findMany({
      where: { memberId: actor.userId, status: { in: [...VISIBLE_STATUSES] } },
      include: { tontine: true },
      orderBy: { joinedAt: 'desc' },
    });
    const counts = await this.prisma.tontineMember.groupBy({
      by: ['tontineId'],
      where: {
        tontineId: { in: rows.map((r) => r.tontineId) },
        status: { in: [...SEATED_STATUSES] },
      },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.tontineId, c._count._all]));
    const current = await this.currentCycles(rows.map((r) => r.tontine));
    return rows.map((r) =>
      tontineView(r.tontine, {
        memberCount: byId.get(r.tontineId) ?? 0,
        myRole: r.role,
        myStatus: r.status,
        currentCycle: current.get(r.tontineId) ?? null,
      }),
    );
  }

  // ------------------------------------------------------------------ US-4.1 création
  async create(actor: Actor, input: CreateTontineInput) {
    const creator = await this.members.snapshot(actor.userId);
    if (!creator) throw new DomainError('NOT_FOUND', 'Profil membre introuvable');
    if (creator.status !== 'ACTIVE')
      throw new DomainError(
        'MEMBER_NOT_ELIGIBLE',
        'Votre compte doit être actif pour créer une tontine',
      );
    const delegatedName = await this.delegation.pendingDelegation(actor.userId);
    // R-TON-02 : KYC TIER_3 requis, sauf délégation du super-admin (A-04)
    const byDelegation = !kycAtLeast(creator.kycLevel, 'TIER_3') && delegatedName !== null;
    if (!kycAtLeast(creator.kycLevel, 'TIER_3') && !byDelegation) {
      throw new DomainError(
        'KYC_LEVEL_INSUFFICIENT',
        'La création d’une tontine requiert une vérification d’identité de niveau 3',
      );
    }
    const country = getCountry(creator.country);
    if (!country)
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        'Renseignez votre pays avant de créer une tontine',
      );
    const currency = (input.currency ?? country.currency).toUpperCase();
    const wallet = await this.prisma.wallet.findUnique({ where: { memberId: actor.userId } });
    // A-11 : l'admin est participant ; son wallet doit être dans la devise de la tontine
    if (!wallet || wallet.currency !== currency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `La tontine doit être en ${wallet?.currency ?? country.currency}, la devise de votre portefeuille`,
      );
    }
    // A-27 : dates civiles dans le fuseau du créateur
    const timezone = country.timezone;
    const { contributionMinor, entryFeeMinor, collationMinor } = this.checkParams(
      input,
      currency,
      timezone,
    );
    await this.compliance.assertCompliant({
      operationType: 'TONTINE_CREATION',
      memberId: actor.userId,
      amountMinor: contributionMinor,
      currency,
      context: { name: input.name },
    });

    try {
      const tontine = await this.uow.run(async (tx) => {
        if (byDelegation && !(await this.delegation.consumeDelegation(tx, actor.userId))) {
          throw new DomainError(
            'KYC_LEVEL_INSUFFICIENT',
            'Délégation déjà utilisée : niveau KYC 3 requis',
          );
        }
        const t = await tx.tontine.create({
          data: {
            name: input.name,
            type: input.type,
            status: 'DRAFT',
            contributionMinor,
            currency,
            frequency: input.frequency,
            frequencyDetail: input.frequencyDetail as object,
            maxMembers: input.maxMembers,
            startDate: new Date(`${input.startDate}T00:00:00Z`),
            timezone,
            drawMode: input.drawMode,
            graceDays: input.penaltyRules.graceDays,
            lateFeeBps: percentToBps(input.penaltyRules.lateFeePercent),
            suspendAfter: input.penaltyRules.suspendAfter,
            defaultAfterDays: input.penaltyRules.defaultAfterDays,
            entryFeeMinor,
            collationMinor,
            incompletePolicy: input.incompletePolicy,
            createdById: actor.userId,
            createdByDelegation: byDelegation,
            createdAt: this.clock.now(),
          },
        });
        const { pool, reserve } = await this.wallets.ensureTontineWallets(tx, t.id, currency);
        const saved = await tx.tontine.update({
          where: { id: t.id },
          data: { poolWalletId: pool.id, reserveWalletId: reserve.id },
        });
        // US-10.2 : compte principal (cotisations) adossé à la cagnotte — seul compte fonctionnel en V1
        await tx.tontineAccount.create({
          data: {
            tontineId: t.id,
            name: 'Compte principal',
            type: 'MAIN',
            rules: {},
            functional: true,
            walletId: pool.id,
            createdById: actor.userId,
            createdAt: this.clock.now(),
          },
        });
        // US-4.1 §5 : le créateur est inscrit comme administrateur (et participant, A-04)
        await tx.tontineMember.create({
          data: {
            tontineId: t.id,
            memberId: actor.userId,
            role: 'ADMIN',
            status: 'ACTIVE',
            joinedAt: this.clock.now(),
            entryFeePaid: entryFeeMinor === 0n,
          },
        });
        await this.outbox.addMany(tx, [
          {
            type: 'tontine.created',
            aggregateType: 'tontine',
            aggregateId: t.id,
            payload: {
              tontineId: t.id,
              createdBy: actor.userId,
              type: t.type,
              params: {
                name: t.name,
                contribution: fromMinor(contributionMinor, currency),
                currency,
                frequency: t.frequency,
                maxMembers: t.maxMembers,
                startDate: input.startDate,
                drawMode: t.drawMode,
                delegated: byDelegation,
              },
            },
          },
          {
            type: 'tontine.member.added',
            aggregateType: 'tontine',
            aggregateId: t.id,
            payload: { tontineId: t.id, memberId: actor.userId, position: null },
          },
        ]);
        await this.audit.record(
          {
            action: 'tontine.created',
            resourceType: 'tontine',
            resourceId: t.id,
            result: 'SUCCESS',
            metadata: { delegated: byDelegation },
          },
          tx,
        );
        return saved;
      });
      return tontineView(tontine, { memberCount: 1, myRole: 'ADMIN', myStatus: 'ACTIVE' });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new DomainError('DUPLICATE_NAME', 'Vous avez déjà une tontine portant ce nom');
      throw e;
    }
  }

  // ------------------------------------------------------------------ A-05 DRAFT ⇄ READY
  /** Recalcule l'état de préparation (appelé à chaque arrivée/départ de participant). */
  async recomputeReadiness(tontineId: string): Promise<void> {
    await this.uow.run(async (tx) => {
      const [t] = await tx.$queryRaw<
        Array<{ status: string }>
      >`SELECT "status"::text AS status FROM "ton_tontines" WHERE "id" = ${tontineId}::uuid FOR UPDATE`;
      if (!t || (t.status !== 'DRAFT' && t.status !== 'READY')) return;
      const active = await tx.tontineMember.count({ where: { tontineId, status: 'ACTIVE' } });
      if (t.status === 'DRAFT' && active >= MIN_MEMBERS) {
        await tx.tontine.update({
          where: { id: tontineId },
          data: { status: 'READY', version: { increment: 1 } },
        });
        await this.outbox.add(tx, {
          type: 'tontine.ready',
          aggregateType: 'tontine',
          aggregateId: tontineId,
          payload: { tontineId, memberCount: active },
        });
      } else if (t.status === 'READY' && active < MIN_MEMBERS) {
        await tx.tontine.update({
          where: { id: tontineId },
          data: { status: 'DRAFT', version: { increment: 1 } },
        });
      }
    });
  }

  // ------------------------------------------------------------------ annulation avant démarrage
  /** Règles communes à la création et à la modification : montants, collation, date J+7. */
  private checkParams(
    input: Pick<CreateTontineInput, 'contributionAmount' | 'entryFee' | 'collation' | 'startDate'>,
    currency: string,
    timezone: string,
  ) {
    const contributionMinor = toMinor(input.contributionAmount, currency);
    const entryFeeMinor = input.entryFee ? toMinor(input.entryFee, currency) : 0n;
    const collationMinor = input.collation ? toMinor(input.collation, currency) : 0n;
    if (contributionMinor <= 0n)
      throw new DomainError(
        'VALIDATION_FAILED',
        'Le montant de contribution doit être supérieur à 0',
      );
    if (collationMinor >= contributionMinor * BigInt(MIN_MEMBERS)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'La collation doit être inférieure au pot minimal (3 contributions)',
      );
    }
    const earliest = addDays(localDate(timezone, this.clock.now()), MIN_START_DELAY_DAYS);
    if (input.startDate < earliest) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `La date de début doit être au plus tôt le ${earliest}`,
        { field: 'startDate', min: earliest },
      );
    }
    return { contributionMinor, entryFeeMinor, collationMinor };
  }

  /**
   * A-61 — modification de la configuration par l'administrateur, uniquement avant démarrage
   * (DRAFT ou READY) et tant qu'aucun autre membre n'a rejoint : les conditions acceptées par
   * des participants ne changent jamais. Devise inchangée (portefeuilles de la tontine créés).
   */
  async update(actor: Actor, tontineId: string, input: UpdateTontineInput) {
    const t = await this.getAdministered(actor, tontineId);
    if (t.status !== 'DRAFT' && t.status !== 'READY') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `Tontine ${t.status} : configuration modifiable uniquement avant le démarrage`,
      );
    }
    if ((await this.seatedCount(t.id)) > 1) {
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        'Des membres ont déjà rejoint la tontine : sa configuration ne peut plus changer',
      );
    }
    if (input.currency && input.currency.toUpperCase() !== t.currency) {
      throw new DomainError('CURRENCY_MISMATCH', `La devise de la tontine est ${t.currency}`);
    }
    const { contributionMinor, entryFeeMinor, collationMinor } = this.checkParams(
      input,
      t.currency,
      t.timezone,
    );
    await this.compliance.assertCompliant({
      operationType: 'TONTINE_CREATION',
      memberId: actor.userId,
      amountMinor: contributionMinor,
      currency: t.currency,
      context: { name: input.name },
    });
    const data = {
      name: input.name,
      contributionMinor,
      frequency: input.frequency,
      frequencyDetail: input.frequencyDetail as object,
      maxMembers: input.maxMembers,
      startDate: new Date(`${input.startDate}T00:00:00Z`),
      drawMode: input.drawMode,
      graceDays: input.penaltyRules.graceDays,
      lateFeeBps: percentToBps(input.penaltyRules.lateFeePercent),
      suspendAfter: input.penaltyRules.suspendAfter,
      defaultAfterDays: input.penaltyRules.defaultAfterDays,
      entryFeeMinor,
      collationMinor,
      incompletePolicy: input.incompletePolicy,
    };
    const changedFields = (Object.keys(data) as Array<keyof typeof data>).filter(
      (k) => JSON.stringify(data[k], jsonBigint) !== JSON.stringify(t[k], jsonBigint),
    );
    try {
      const updated = await this.uow.run(async (tx) => {
        const res = await tx.tontine.updateMany({
          where: { id: t.id, version: input.version, status: { in: ['DRAFT', 'READY'] } },
          data: { ...data, version: { increment: 1 } },
        });
        if (res.count !== 1)
          throw new DomainError('VERSION_CONFLICT', 'La tontine a été modifiée entre-temps');
        if (entryFeeMinor === 0n) {
          await tx.tontineMember.updateMany({
            where: { tontineId: t.id, memberId: actor.userId },
            data: { entryFeePaid: true },
          });
        }
        await this.outbox.add(tx, {
          type: 'tontine.updated',
          aggregateType: 'tontine',
          aggregateId: t.id,
          payload: { tontineId: t.id, updatedBy: actor.userId, changedFields },
        });
        await this.audit.record(
          {
            action: 'tontine.updated',
            resourceType: 'tontine',
            resourceId: t.id,
            result: 'SUCCESS',
            metadata: { changedFields },
          },
          tx,
        );
        return tx.tontine.findUniqueOrThrow({ where: { id: t.id } });
      });
      return tontineView(updated, { memberCount: 1, myRole: 'ADMIN', myStatus: 'ACTIVE' });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new DomainError('DUPLICATE_NAME', 'Vous avez déjà une tontine portant ce nom');
      throw e;
    }
  }

  async cancel(actor: Actor, tontineId: string, reason: string) {
    const t = await this.getAdministered(actor, tontineId);
    if (t.status !== 'DRAFT' && t.status !== 'READY') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `Tontine ${t.status} : annulation impossible (uniquement avant démarrage)`,
      );
    }
    const updated = await this.uow.run(async (tx) => {
      const res = await tx.tontine.updateMany({
        where: { id: t.id, status: { in: ['DRAFT', 'READY'] } },
        data: { status: 'CANCELLED', cancelledAt: this.clock.now(), version: { increment: 1 } },
      });
      if (res.count !== 1)
        throw new DomainError('VERSION_CONFLICT', 'La tontine a changé d’état entre-temps');
      await tx.tontineInvitation.updateMany({
        where: { tontineId: t.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      await this.outbox.add(tx, {
        type: 'tontine.cancelled',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: { tontineId: t.id, reason },
      });
      await this.audit.record(
        {
          action: 'tontine.cancelled',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { reason },
        },
        tx,
      );
      return tx.tontine.findUniqueOrThrow({ where: { id: t.id } });
    });
    return tontineView(updated, {
      memberCount: await this.seatedCount(t.id),
      myRole: 'ADMIN',
      myStatus: 'ACTIVE',
    });
  }

  /** Vue membre des participants : prénom, rôle, position — aucun montant individuel. */
  async participants(actor: Actor, tontineId: string) {
    const { tontine } = await this.getVisible(actor, tontineId);
    const rows = await this.prisma.tontineMember.findMany({
      where: { tontineId, status: { in: [...VISIBLE_STATUSES] } },
      orderBy: [{ position: 'asc' }, { joinedAt: 'asc' }],
    });
    const snaps = new Map(
      (await this.members.snapshots(rows.map((r) => r.memberId))).map((s) => [s.id, s]),
    );
    const current = tontine.currentCycleNumber
      ? await this.prisma.tontineCycle.findUnique({
          where: { tontineId_number: { tontineId, number: tontine.currentCycleNumber } },
          include: { contributions: { select: { memberId: true, status: true } } },
        })
      : null;
    const statusBy = new Map(current?.contributions.map((c) => [c.memberId, c.status]) ?? []);
    return rows.map((r) => ({
      memberId: r.memberId,
      firstName: snaps.get(r.memberId)?.firstName ?? '—',
      role: r.role,
      status: r.status,
      position: r.position,
      receivedPayout: r.receivedPayout,
      currentContributionStatus: statusBy.get(r.memberId) ?? null,
    }));
  }
}
