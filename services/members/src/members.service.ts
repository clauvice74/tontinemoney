import { Injectable, Logger } from '@nestjs/common';
import {
  type KycLevel,
  type MemberHistoryQuery,
  type MemberStatus,
  type UpdateProfileInput,
  type NotificationPrefs,
  buildPage,
  decodeCursor,
  maskEmail,
  maskPhone,
} from '@tontine/contracts';
import { type Member, type TxClient } from '@tontine/database';
import { type EventPayload } from '@tontine/events';
import {
  type Actor,
  AuditService,
  Clock,
  DomainError,
  OutboxService,
  PrismaService,
  RequestContext,
  UnitOfWork,
} from '@tontine/platform';
import { type MemberTrigger, transition } from './domain/member-status';
import {
  type CountrySource,
  ageOn,
  canOverrideCountry,
  deduceCountry,
  defaultNotificationPrefs,
  defaultsFor,
  isProfileComplete,
} from './domain/profile';

type ActorRoleValue = 'SYSTEM' | 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN' | 'KYC_AGENT';

export interface MemberView {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  countrySource: string | null;
  region: string | null;
  city: string | null;
  address: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  language: string;
  timezone: string;
  status: MemberStatus;
  kycLevel: KycLevel;
  complianceStatus: string;
  notificationPrefs: NotificationPrefs;
  hasPhoto: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toMemberView(m: Member): MemberView {
  return {
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email,
    phone: m.phone,
    country: m.countryCode,
    countrySource: m.countrySource,
    region: m.region,
    city: m.city,
    address: m.address,
    dateOfBirth: m.dateOfBirth ? m.dateOfBirth.toISOString().slice(0, 10) : null,
    gender: m.gender,
    language: m.language,
    timezone: m.timezone,
    status: m.status,
    kycLevel: m.kycLevel,
    complianceStatus: m.complianceStatus,
    notificationPrefs: m.notificationPrefs as NotificationPrefs,
    hasPhoto: !!m.profilePhotoRef,
    version: m.version,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** Vue restreinte (admin de tontine partagée) : aucune donnée sensible (US-2.3 §8). */
export function toLimitedView(m: Member) {
  return {
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    email: maskEmail(m.email),
    phone: maskPhone(m.phone),
    status: m.status,
    kycLevel: m.kycLevel,
    createdAt: m.createdAt.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIER_ORDER: KycLevel[] = ['NONE', 'TIER_1', 'TIER_2', 'TIER_3'];
export const kycRank = (l: KycLevel) => TIER_ORDER.indexOf(l);

type ProfileField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'countryCode'
  | 'region'
  | 'city'
  | 'address'
  | 'dateOfBirth'
  | 'gender'
  | 'language'
  | 'timezone';

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  private roleOf(actor: Actor | null): ActorRoleValue {
    if (!actor) return 'SYSTEM';
    if (actor.role === 'SUPER_ADMIN') return 'SUPER_ADMIN';
    if (actor.role === 'KYC_AGENT') return 'KYC_AGENT';
    return 'MEMBER';
  }

  async get(memberId: string): Promise<Member> {
    const m = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!m) throw new DomainError('NOT_FOUND', 'Membre introuvable');
    return m;
  }

  /** US-2.1 — création automatique idempotente à la réception de `user.registered`. */
  async createFromRegistration(p: EventPayload<'user.registered'>): Promise<'created' | 'ignored'> {
    return this.uow.run(async (tx) => {
      const existing = await tx.member.findUnique({
        where: { id: p.userId },
        select: { id: true },
      });
      if (existing) return 'ignored';
      const resolved = deduceCountry({
        country: p.country,
        phone: p.phone,
        ipCountry: RequestContext.current()?.country,
      });
      const defaults = defaultsFor(resolved?.country);
      const member = await tx.member.create({
        data: {
          id: p.userId,
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          phone: p.phone,
          countryCode: resolved?.country ?? null,
          countrySource: resolved?.source ?? null,
          language: p.language ?? defaults.language,
          timezone: defaults.timezone,
          status: 'PENDING',
          kycLevel: 'NONE',
          notificationPrefs: defaultNotificationPrefs(
            resolved?.country,
            p.preferredChannel,
          ) as object,
          version: 1,
        },
      });
      await tx.memberAuditLog.create({
        data: {
          memberId: member.id,
          action: 'CREATED',
          changedBy: p.registeredBy,
          changedByRole: p.registeredBy ? 'ADMIN' : 'SYSTEM',
          trigger: 'user.registered',
          newValues: {
            status: member.status,
            country: member.countryCode,
            language: member.language,
          },
        },
      });
      await this.outbox.add(tx, {
        type: 'member.created',
        aggregateType: 'member',
        aggregateId: member.id,
        payload: {
          memberId: member.id,
          country: member.countryCode,
          language: member.language,
          status: member.status,
          currency: defaults.currency,
        },
      });
      return 'created';
    });
  }

  /** Activation du compte : contact vérifié → TIER_1, puis contrôle de complétude. */
  async onActivated(userId: string): Promise<void> {
    await this.uow.run(async (tx) => {
      const m = await tx.member.findUnique({ where: { id: userId } });
      if (!m) return;
      if (m.kycLevel === 'NONE') {
        await tx.member.update({
          where: { id: m.id },
          data: { kycLevel: 'TIER_1', version: { increment: 1 } },
        });
        await tx.memberAuditLog.create({
          data: {
            memberId: m.id,
            action: 'KYC_LEVEL_CHANGED',
            changedByRole: 'SYSTEM',
            trigger: 'user.activated',
            oldValues: { kycLevel: m.kycLevel },
            newValues: { kycLevel: 'TIER_1' },
          },
        });
      }
      await this.checkCompleteness(tx, {
        ...m,
        kycLevel: m.kycLevel === 'NONE' ? 'TIER_1' : m.kycLevel,
      });
    });
  }

  private async checkCompleteness(tx: TxClient, m: Member): Promise<void> {
    if (m.status !== 'PENDING' || !isProfileComplete(m)) return;
    await this.applyTriggerTx(tx, m, 'profile.completed', {
      reason: 'Profil complété',
      changedBy: null,
      changedByRole: 'SYSTEM',
    });
    await this.outbox.add(tx, {
      type: 'member.kyc.required',
      aggregateType: 'member',
      aggregateId: m.id,
      payload: { memberId: m.id },
    });
  }

  /** US-2.2 — mise à jour versionnée du profil. */
  async updateProfile(
    actor: Actor,
    memberId: string,
    input: UpdateProfileInput,
  ): Promise<MemberView> {
    const updated = await this.uow.run(async (tx) => {
      const m = await tx.member.findUnique({ where: { id: memberId } });
      if (!m) throw new DomainError('NOT_FOUND', 'Membre introuvable');
      if (m.version !== input.version) throw new DomainError('VERSION_CONFLICT');
      if (m.status === 'SUSPENDED') throw new DomainError('FORBIDDEN', 'Compte suspendu');

      const next: Partial<Record<ProfileField, unknown>> = {};
      const set = <K extends ProfileField>(k: K, v: unknown) => {
        if (v !== undefined) next[k] = v;
      };
      set('firstName', input.firstName);
      set('lastName', input.lastName);
      set('email', input.email);
      set('phone', input.phone);
      set('countryCode', input.country);
      set('region', input.region);
      set('city', input.city);
      set('address', input.address);
      set('dateOfBirth', input.dateOfBirth);
      set('gender', input.gender);
      set('language', input.language);
      set('timezone', input.timezone);

      const current: Record<string, unknown> = {
        ...m,
        dateOfBirth: m.dateOfBirth ? m.dateOfBirth.toISOString().slice(0, 10) : null,
      };
      const changed = Object.keys(next).filter((k) => next[k as keyof typeof next] !== current[k]);
      if (changed.length === 0) return m;

      if (
        (changed.includes('firstName') || changed.includes('lastName')) &&
        kycRank(m.kycLevel) >= kycRank('TIER_2')
      ) {
        throw new DomainError('NAME_LOCKED_AFTER_KYC');
      }
      if (
        changed.includes('countryCode') &&
        !canOverrideCountry(m.countrySource as CountrySource | null, 'PROFILE')
      ) {
        throw new DomainError(
          'FORBIDDEN',
          'Le pays a été établi par la vérification d’identité et ne peut pas être modifié',
        );
      }
      if (changed.includes('dateOfBirth') && typeof next.dateOfBirth === 'string') {
        if (ageOn(next.dateOfBirth, this.clock.today()) < 18) {
          throw new DomainError(
            'BUSINESS_RULE_VIOLATION',
            'Vous devez avoir au moins 18 ans pour utiliser les services financiers',
          );
        }
      }
      if (changed.includes('email') && next.email) {
        const dup = await tx.member.findFirst({
          where: { email: next.email as string, id: { not: m.id } },
          select: { id: true },
        });
        if (dup) throw new DomainError('EMAIL_ALREADY_USED');
      }
      if (changed.includes('phone') && next.phone) {
        const dup = await tx.member.findFirst({
          where: { phone: next.phone as string, id: { not: m.id } },
          select: { id: true },
        });
        if (dup) throw new DomainError('PHONE_ALREADY_USED');
      }

      const data: Record<string, unknown> = {};
      for (const k of changed)
        data[k] =
          k === 'dateOfBirth' && next.dateOfBirth
            ? new Date(`${String(next.dateOfBirth)}T00:00:00Z`)
            : next[k as keyof typeof next];
      if (changed.includes('countryCode')) data['countrySource'] = 'PROFILE';

      // Verrou optimiste (US-2.2 §6)
      const res = await tx.member.updateMany({
        where: { id: m.id, version: m.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new DomainError('VERSION_CONFLICT');
      const after = await tx.member.findUniqueOrThrow({ where: { id: m.id } });

      const publicKey = (k: string) => (k === 'countryCode' ? 'country' : k);
      const oldValues = Object.fromEntries(changed.map((k) => [publicKey(k), current[k] ?? null]));
      const newValues = Object.fromEntries(
        changed.map((k) => [publicKey(k), next[k as keyof typeof next] ?? null]),
      );
      const ctx = RequestContext.metadata();
      await tx.memberAuditLog.create({
        data: {
          memberId: m.id,
          action: 'UPDATED',
          changedBy: actor.userId,
          changedByRole: this.roleOf(actor),
          trigger: 'profile.update',
          oldValues: oldValues as object,
          newValues: newValues as object,
          ipAddress: ctx.ip,
          deviceInfo: ctx.userAgent?.slice(0, 255) ?? null,
        },
      });
      await this.outbox.add(tx, {
        type: 'member.updated',
        aggregateType: 'member',
        aggregateId: m.id,
        payload: {
          memberId: m.id,
          changedFields: changed.map(publicKey),
          oldValues,
          newValues,
        },
      });
      await this.checkCompleteness(tx, after);
      return tx.member.findUniqueOrThrow({ where: { id: m.id } });
    });
    return toMemberView(updated);
  }

  async updateNotificationPrefs(actor: Actor, prefs: NotificationPrefs): Promise<MemberView> {
    // R-NOT-04 : la catégorie SECURITY est toujours active.
    const enabledTypes = [...new Set([...prefs.enabledTypes, 'SECURITY'])];
    const m = await this.uow.run(async (tx) => {
      const before = await tx.member.findUniqueOrThrow({ where: { id: actor.userId } });
      const after = await tx.member.update({
        where: { id: actor.userId },
        data: {
          notificationPrefs: { ...prefs, enabledTypes } as object,
          version: { increment: 1 },
        },
      });
      await tx.memberAuditLog.create({
        data: {
          memberId: actor.userId,
          action: 'UPDATED',
          changedBy: actor.userId,
          changedByRole: 'MEMBER',
          trigger: 'notification.preferences',
          oldValues: { notificationPrefs: before.notificationPrefs } as object,
          newValues: { notificationPrefs: after.notificationPrefs } as object,
        },
      });
      return after;
    });
    return toMemberView(m);
  }

  /** US-2.6 — applique un déclencheur ; transition invalide ignorée et journalisée. */
  async applyTrigger(
    memberId: string,
    trigger: MemberTrigger,
    meta: {
      reason: string;
      changedBy: string | null;
      changedByRole: ActorRoleValue;
      kycLevel?: KycLevel;
    },
  ): Promise<boolean> {
    return this.uow.run(async (tx) => {
      const m = await tx.member.findUnique({ where: { id: memberId } });
      if (!m) {
        this.logger.warn(`Déclencheur ${trigger} ignoré : membre ${memberId} inconnu`);
        return false;
      }
      return this.applyTriggerTx(tx, m, trigger, meta);
    });
  }

  async applyTriggerTx(
    tx: TxClient,
    m: Member,
    trigger: MemberTrigger,
    meta: {
      reason: string;
      changedBy: string | null;
      changedByRole: ActorRoleValue;
      kycLevel?: KycLevel;
    },
  ): Promise<boolean> {
    const res = transition(m.status, trigger);
    if (!res.ok) {
      this.logger.debug(res.reason);
      await tx.memberAuditLog.create({
        data: {
          memberId: m.id,
          action: 'INVALID_TRANSITION',
          changedBy: meta.changedBy,
          changedByRole: meta.changedByRole,
          trigger,
          oldValues: { status: m.status },
          newValues: { ignored: true, reason: res.reason },
        },
      });
      // Le niveau KYC peut évoluer même si le statut ne change pas (ex. passage TIER_3 d'un membre ACTIVE).
      if (meta.kycLevel && meta.kycLevel !== m.kycLevel && trigger === 'kyc.verified') {
        await this.setKycLevelTx(tx, m, meta.kycLevel, trigger);
      }
      return false;
    }
    const data: Record<string, unknown> = { status: res.to, version: { increment: 1 } };
    await tx.member.update({ where: { id: m.id }, data });
    await tx.memberAuditLog.create({
      data: {
        memberId: m.id,
        action:
          res.to === 'SUSPENDED'
            ? 'SUSPENDED'
            : trigger === 'admin.reactivate'
              ? 'REACTIVATED'
              : 'STATUS_CHANGED',
        changedBy: meta.changedBy,
        changedByRole: meta.changedByRole,
        trigger,
        oldValues: { status: m.status },
        newValues: { status: res.to, reason: meta.reason },
      },
    });
    if (meta.kycLevel && meta.kycLevel !== m.kycLevel)
      await this.setKycLevelTx(tx, m, meta.kycLevel, trigger);
    await this.outbox.add(tx, {
      type: 'member.status.changed',
      aggregateType: 'member',
      aggregateId: m.id,
      payload: {
        memberId: m.id,
        oldStatus: m.status,
        newStatus: res.to,
        reason: meta.reason,
        changedBy: meta.changedBy ?? 'SYSTEM',
      },
    });
    if (res.to === 'SUSPENDED') {
      await this.outbox.add(tx, {
        type: 'member.suspended',
        aggregateType: 'member',
        aggregateId: m.id,
        payload: { memberId: m.id, reason: meta.reason, suspendedBy: meta.changedBy ?? 'SYSTEM' },
      });
    }
    if (trigger === 'admin.reactivate') {
      await this.outbox.add(tx, {
        type: 'member.reactivated',
        aggregateType: 'member',
        aggregateId: m.id,
        payload: { memberId: m.id, reason: meta.reason, reactivatedBy: meta.changedBy ?? 'SYSTEM' },
      });
    }
    return true;
  }

  private async setKycLevelTx(
    tx: TxClient,
    m: Member,
    level: KycLevel,
    trigger: string,
  ): Promise<void> {
    await tx.member.update({ where: { id: m.id }, data: { kycLevel: level } });
    await tx.memberAuditLog.create({
      data: {
        memberId: m.id,
        action: 'KYC_LEVEL_CHANGED',
        changedByRole: 'SYSTEM',
        trigger,
        oldValues: { kycLevel: m.kycLevel },
        newValues: { kycLevel: level },
      },
    });
  }

  /** Niveau KYC abaissé (expiration, US-3.6) sans changement de statut. */
  async setKycLevel(memberId: string, level: KycLevel, trigger: string): Promise<void> {
    await this.uow.run(async (tx) => {
      const m = await tx.member.findUnique({ where: { id: memberId } });
      if (m && m.kycLevel !== level) await this.setKycLevelTx(tx, m, level, trigger);
    });
  }

  /** Pays issu du document KYC : source prioritaire (US-9.1). */
  async setCountryFromKyc(memberId: string, country: string): Promise<void> {
    await this.uow.run(async (tx) => {
      const m = await tx.member.findUnique({ where: { id: memberId } });
      if (!m || (m.countryCode === country && m.countrySource === 'KYC')) return;
      await tx.member.update({
        where: { id: m.id },
        data: { countryCode: country, countrySource: 'KYC', version: { increment: 1 } },
      });
      await tx.memberAuditLog.create({
        data: {
          memberId: m.id,
          action: 'UPDATED',
          changedByRole: 'SYSTEM',
          trigger: 'kyc.verified',
          oldValues: { countryCode: m.countryCode, countrySource: m.countrySource },
          newValues: { countryCode: country, countrySource: 'KYC' },
        },
      });
      if (m.countryCode !== country) {
        await this.outbox.add(tx, {
          type: 'member.updated',
          aggregateType: 'member',
          aggregateId: m.id,
          payload: {
            memberId: m.id,
            changedFields: ['country'],
            oldValues: { country: m.countryCode },
            newValues: { country },
          },
        });
      }
    });
  }

  async setComplianceStatus(
    memberId: string,
    status: 'RESTRICTED' | 'COMPLIANT' | 'UNDER_REVIEW',
    reason: string,
  ): Promise<void> {
    await this.uow.run(async (tx) => {
      const m = await tx.member.findUnique({ where: { id: memberId } });
      if (!m || m.complianceStatus === status) return;
      await tx.member.update({ where: { id: m.id }, data: { complianceStatus: status } });
      await tx.memberAuditLog.create({
        data: {
          memberId: m.id,
          action: 'UPDATED',
          changedByRole: 'SYSTEM',
          trigger: 'compliance',
          oldValues: { complianceStatus: m.complianceStatus },
          newValues: { complianceStatus: status, reason },
        },
      });
    });
  }

  /** Journalise une décision d'accès (US-2.4 §5) dans l'historique du membre. */
  async recordAccessDecision(
    memberId: string,
    decision: string,
    reason: string | null,
    decidedBy: string | null,
  ): Promise<void> {
    const m = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!m) return;
    await this.prisma.memberAuditLog.create({
      data: {
        memberId,
        action: 'STATUS_CHANGED',
        changedBy: decidedBy,
        changedByRole: 'ADMIN',
        trigger: 'access.decision',
        newValues: { decision, reason },
      },
    });
  }

  async setPhoto(actor: Actor, ref: string): Promise<void> {
    await this.uow.run(async (tx) => {
      const before = await tx.member.findUniqueOrThrow({ where: { id: actor.userId } });
      await tx.member.update({
        where: { id: actor.userId },
        data: { profilePhotoRef: ref, version: { increment: 1 } },
      });
      await tx.memberAuditLog.create({
        data: {
          memberId: actor.userId,
          action: 'UPDATED',
          changedBy: actor.userId,
          changedByRole: 'MEMBER',
          trigger: 'profile.photo',
          oldValues: { hasPhoto: !!before.profilePhotoRef },
          newValues: { hasPhoto: true },
        },
      });
    });
  }

  async touchActivity(memberId: string): Promise<void> {
    await this.prisma.member.updateMany({
      where: { id: memberId },
      data: { lastActivityAt: this.clock.now() },
    });
  }

  async history(memberId: string, limit = 50) {
    return this.prisma.memberAuditLog.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Historique paginé par curseur `(createdAt, id)`, le plus récent d'abord. */
  async historyPage(memberId: string, q: MemberHistoryQuery) {
    await this.get(memberId);
    const cursor = decodeCursor(q.cursor);
    const before = cursor && typeof cursor.k === 'string' ? new Date(cursor.k) : null;
    const after =
      cursor && before && !Number.isNaN(before.getTime()) && UUID.test(cursor.id)
        ? { OR: [{ createdAt: { lt: before } }, { createdAt: before, id: { lt: cursor.id } }] }
        : {};
    const rows = await this.prisma.memberAuditLog.findMany({
      where: { memberId, ...after },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { items, nextCursor } = buildPage(rows, q.limit, (r) => r.createdAt.toISOString());
    return {
      data: items.map((r) => ({
        id: r.id,
        action: r.action,
        trigger: r.trigger,
        changedBy: r.changedBy,
        changedByRole: r.changedByRole,
        oldValues: r.oldValues,
        newValues: r.newValues,
        createdAt: r.createdAt.toISOString(),
      })),
      page: { nextCursor, limit: q.limit },
    };
  }

  /**
   * Statut courant et dernier changement de statut. Le motif n'est exposé qu'au personnel
   * (`withReason`) : une suspension pour suspicion de fraude ne doit pas être révélée au membre.
   */
  async statusView(memberId: string, withReason: boolean) {
    const m = await this.get(memberId);
    const last = await this.prisma.memberAuditLog.findFirst({
      where: { memberId, action: { in: ['STATUS_CHANGED', 'SUSPENDED', 'REACTIVATED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const newValues = (last?.newValues ?? null) as { status?: unknown; reason?: unknown } | null;
    return {
      id: m.id,
      status: m.status,
      kycLevel: m.kycLevel,
      complianceStatus: m.complianceStatus,
      lastChange: last
        ? {
            at: last.createdAt.toISOString(),
            trigger: last.trigger,
            ...(withReason
              ? {
                  reason: typeof newValues?.reason === 'string' ? newValues.reason : null,
                  changedBy: last.changedBy,
                  changedByRole: last.changedByRole,
                }
              : {}),
          }
        : null,
    };
  }

  async auditAccess(memberId: string | null, action: string): Promise<void> {
    await this.audit.record({
      action,
      resourceType: 'member',
      resourceId: memberId,
      result: 'SUCCESS',
    });
  }
}
