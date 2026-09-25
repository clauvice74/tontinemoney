import { Inject, Injectable } from '@nestjs/common';
import {
  generateNumericOtp,
  generateOpaqueToken,
  hashSecret,
  resolveBcryptCost,
  sha256Hex,
  verifySecret,
} from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import {
  type AccessDecisionInput,
  type ActivateAccountInput,
  type CommunicationChannel,
  type CreateTontineAdminInput,
  type RegisterMemberInput,
  type RequestAccountInput,
  countryFromPhone,
  getCountry,
  isE164,
  normalizePhone,
} from '@tontine/contracts';
import { type TxClient, type User, isUniqueViolation } from '@tontine/database';
import { NotificationService } from '@tontine/notifications';
import {
  APP_CONFIG,
  AccessDeniedMonitor,
  type Actor,
  AuditService,
  Clock,
  DomainError,
  OutboxService,
  PrismaService,
  RateLimiter,
  RequestContext,
  ScheduledJob,
  TONTINE_ACCESS,
  type TontineAccessPort,
  UnitOfWork,
} from '@tontine/platform';
import { CaptchaVerifier } from './captcha';

export const ACTIVATION_LINK_TTL_MS = 48 * 3600 * 1000;
export const OTP_TTL_MS = 15 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_LOCK_MS = 15 * 60 * 1000;
export const ACCESS_REQUEST_TTL_MS = 30 * 24 * 3600 * 1000;

interface PendingSecret {
  channel: CommunicationChannel;
  secret: string;
}

/** Recherche un compte par email ou téléphone (identifiant de connexion). */
export async function findUserByIdentifier(
  db: TxClient | PrismaService,
  identifier: string,
): Promise<User | null> {
  const value = identifier.trim();
  if (value.includes('@')) return db.user.findUnique({ where: { email: value.toLowerCase() } });
  const phone = normalizePhone(value);
  if (!isE164(phone)) return null;
  return db.user.findUnique({ where: { phone } });
}

/**
 * Inscription et activation des comptes (US-1.1, US-1.2, US-1.3), demandes d'accès (US-2.4, US-10.1).
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationService,
    private readonly captcha: CaptchaVerifier,
    private readonly denied: AccessDeniedMonitor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TONTINE_ACCESS) private readonly tontines: TontineAccessPort,
  ) {}

  private get cost(): number {
    return resolveBcryptCost(this.config.BCRYPT_COST, this.config.NODE_ENV);
  }

  activationUrl(token: string): string {
    return `${this.config.APP_PUBLIC_URL}/activate/${token}`;
  }

  private async assertUnique(
    email: string | null | undefined,
    phone: string | null | undefined,
    code: 'split' | 'member',
  ) {
    if (email && (await this.prisma.user.findUnique({ where: { email }, select: { id: true } }))) {
      throw new DomainError(code === 'member' ? 'MEMBER_ALREADY_EXISTS' : 'EMAIL_ALREADY_USED');
    }
    if (phone && (await this.prisma.user.findUnique({ where: { phone }, select: { id: true } }))) {
      throw new DomainError(code === 'member' ? 'MEMBER_ALREADY_EXISTS' : 'PHONE_ALREADY_USED');
    }
  }

  /** Crée un jeton d'activation (lien 48 h ou OTP 15 min) ; le secret n'est renvoyé qu'à l'appelant. */
  private async issueActivation(
    tx: TxClient,
    user: Pick<User, 'id'>,
    channel: CommunicationChannel,
  ): Promise<PendingSecret> {
    const now = this.clock.now();
    await tx.authToken.updateMany({
      where: {
        userId: user.id,
        type: { in: ['ACTIVATION_LINK', 'ACTIVATION_OTP'] },
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    if (channel === 'SMS') {
      const otp = generateNumericOtp(6);
      await tx.authToken.create({
        data: {
          createdAt: now,
          userId: user.id,
          type: 'ACTIVATION_OTP',
          tokenHash: await hashSecret(otp, this.cost),
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
      });
      return { channel, secret: otp };
    }
    const token = generateOpaqueToken();
    await tx.authToken.create({
      data: {
        createdAt: now,
        userId: user.id,
        type: 'ACTIVATION_LINK',
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + ACTIVATION_LINK_TTL_MS),
      },
    });
    return { channel, secret: token };
  }

  private async deliverActivation(user: User, pending: PendingSecret, alsoSms = false) {
    const language = user.language;
    if (pending.channel === 'SMS') {
      return this.notifications.sendDirect({
        to: { phone: user.phone },
        userId: user.id,
        template: 'auth.activation_otp',
        vars: { code: pending.secret },
        language,
        country: user.countryCode,
        channels: ['SMS'],
      });
    }
    return this.notifications.sendDirect({
      to: { email: user.email, phone: user.phone },
      userId: user.id,
      template: 'auth.activation_link',
      vars: { prenom: user.firstName, lien: this.activationUrl(pending.secret) },
      language,
      country: user.countryCode,
      channels: alsoSms ? ['EMAIL', 'SMS'] : ['EMAIL'],
    });
  }

  /** US-1.1 — création d'un administrateur de tontine par le super-admin. */
  async createTontineAdmin(actor: Actor, input: CreateTontineAdminInput) {
    await this.assertUnique(input.email, input.phone, 'split');
    let pending!: PendingSecret;
    let user: User;
    try {
      user = await this.uow.run(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: input.email,
            phone: input.phone,
            role: 'TONTINE_ADMIN',
            status: 'PENDING_ACTIVATION',
            firstName: input.firstName,
            lastName: input.lastName,
            countryCode: input.country,
            language: input.language,
            preferredChannel: 'EMAIL',
            createdById: actor.userId,
            delegatedTontineName: input.tontineName,
          },
        });
        pending = await this.issueActivation(tx, u, 'EMAIL');
        await this.outbox.add(tx, {
          type: 'user.registered',
          aggregateType: 'user',
          aggregateId: u.id,
          payload: {
            userId: u.id,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
            phone: u.phone,
            country: u.countryCode,
            language: u.language,
            role: 'TONTINE_ADMIN',
            preferredChannel: 'EMAIL',
            registeredBy: actor.userId,
            tontineId: null,
          },
        });
        await this.audit.record(
          {
            action: 'tontine_admin.created',
            resourceType: 'user',
            resourceId: u.id,
            result: 'SUCCESS',
            metadata: { tontineName: input.tontineName },
          },
          tx,
        );
        return u;
      });
    } catch (e) {
      if (isUniqueViolation(e, 'email')) throw new DomainError('EMAIL_ALREADY_USED');
      if (isUniqueViolation(e, 'phone')) throw new DomainError('PHONE_ALREADY_USED');
      throw e;
    }
    // Double canal (email ET SMS) ; si le SMS échoue, l'email suffit et une alerte interne est levée.
    const delivery = await this.deliverActivation(user, pending, true);
    return {
      id: user.id,
      status: user.status,
      role: user.role,
      tontineName: input.tontineName,
      activation: {
        expiresAt: new Date(this.clock.now().getTime() + ACTIVATION_LINK_TTL_MS).toISOString(),
        delivered: delivery.delivered,
        failed: delivery.failed,
      },
    };
  }

  /** US-1.2 — inscription d'un membre par l'admin de la tontine. */
  async registerMember(actor: Actor, tontineId: string, input: RegisterMemberInput) {
    const tontine = await this.tontines.describe(tontineId);
    if (!tontine) throw new DomainError('NOT_FOUND', 'Tontine introuvable');
    if (!(await this.tontines.isAdmin(tontineId, actor.userId))) {
      await this.denied.record('tontine', tontineId, 'register-member:not-admin');
      throw new DomainError('FORBIDDEN', 'Vous n’administrez pas cette tontine');
    }
    await this.limiter.consume(
      { name: 'register-member', limit: 50, windowSeconds: 3600 },
      actor.userId,
    );
    await this.assertUnique(input.email, input.phone, 'member');
    const country = input.country ?? countryFromPhone(input.phone) ?? null;
    let pending!: PendingSecret;
    let user: User;
    try {
      user = await this.uow.run(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: input.email ?? null,
            phone: input.phone ?? null,
            role: 'MEMBER',
            status: 'PENDING_ACTIVATION',
            firstName: input.firstName,
            lastName: input.lastName,
            countryCode: country,
            language: getCountry(country)?.language ?? 'fr',
            preferredChannel: input.preferredChannel,
            createdById: actor.userId,
          },
        });
        pending = await this.issueActivation(tx, u, input.preferredChannel);
        await this.outbox.add(tx, {
          type: 'user.registered',
          aggregateType: 'user',
          aggregateId: u.id,
          payload: {
            userId: u.id,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
            phone: u.phone,
            country,
            language: u.language,
            role: 'MEMBER',
            preferredChannel: input.preferredChannel,
            registeredBy: actor.userId,
            tontineId,
          },
        });
        return u;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError('MEMBER_ALREADY_EXISTS');
      throw e;
    }
    const delivery = await this.deliverActivation(user, pending);
    return {
      id: user.id,
      status: user.status,
      channel: input.preferredChannel,
      delivered: delivery.delivered,
    };
  }

  /** Renvoi du code / lien d'activation : 3 renvois maximum par heure (anti-spam SMS). */
  async resendActivation(identifier: string): Promise<void> {
    const user = await findUserByIdentifier(this.prisma, identifier);
    if (!user || user.status !== 'PENDING_ACTIVATION') return; // pas de fuite d'information
    const hourAgo = new Date(this.clock.now().getTime() - 3600_000);
    const recent = await this.prisma.authToken.count({
      where: {
        userId: user.id,
        type: { in: ['ACTIVATION_OTP', 'ACTIVATION_LINK'] },
        createdAt: { gte: hourAgo },
      },
    });
    if (recent >= 4)
      throw new DomainError('RATE_LIMITED', 'Maximum 3 renvois par heure', { retryAfter: 3600 });
    const channel = user.preferredChannel ?? (user.phone ? 'SMS' : 'EMAIL');
    const pending = await this.uow.run((tx) => this.issueActivation(tx, user, channel));
    await this.deliverActivation(user, pending);
  }

  /** Activation par lien (48 h) ou OTP (15 min, 3 essais puis blocage 15 min). */
  async activate(input: ActivateAccountInput): Promise<{ activated: true; userId: string }> {
    const now = this.clock.now();
    let user: User | null;
    let tokenId: string;
    if (input.token) {
      const token = await this.prisma.authToken.findFirst({
        where: { tokenHash: sha256Hex(input.token), type: 'ACTIVATION_LINK' },
        include: { user: true },
      });
      if (!token) throw new DomainError('INVALID_TOKEN', 'Lien d’activation invalide');
      if (token.consumedAt) throw new DomainError('TOKEN_ALREADY_USED');
      if (token.revokedAt || token.expiresAt <= now) throw new DomainError('TOKEN_EXPIRED');
      user = token.user;
      tokenId = token.id;
    } else {
      user = await findUserByIdentifier(this.prisma, input.identifier ?? '');
      if (!user) throw new DomainError('INVALID_OTP');
      const token = await this.prisma.authToken.findFirst({
        where: { userId: user.id, type: 'ACTIVATION_OTP', consumedAt: null, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!token) throw new DomainError('INVALID_OTP');
      if (token.lockedUntil && token.lockedUntil > now) throw new DomainError('OTP_LOCKED');
      if (token.expiresAt <= now) throw new DomainError('OTP_EXPIRED');
      if (!(await verifySecret(input.otp ?? '', token.tokenHash))) {
        const attempts = token.attempts + 1;
        const locked = attempts >= OTP_MAX_ATTEMPTS;
        await this.prisma.authToken.update({
          where: { id: token.id },
          data: {
            attempts: locked ? 0 : attempts,
            lockedUntil: locked ? new Date(now.getTime() + OTP_LOCK_MS) : null,
          },
        });
        if (locked) {
          await this.audit.record({
            action: 'activation.otp_locked',
            resourceType: 'user',
            resourceId: user.id,
            result: 'DENIED',
          });
          if (user.createdById) {
            await this.notifications.notify({
              recipientIds: [user.createdById],
              template: 'ops.alert',
              vars: {
                message: `Activation bloquée 15 minutes pour ${user.firstName} ${user.lastName} après 3 codes erronés.`,
              },
            });
          }
          throw new DomainError('OTP_LOCKED');
        }
        throw new DomainError('INVALID_OTP');
      }
      tokenId = token.id;
    }
    if (!user || user.status !== 'PENDING_ACTIVATION')
      throw new DomainError('TOKEN_ALREADY_USED', 'Compte déjà activé');
    const passwordHash = await hashSecret(input.password, this.cost);
    const activeUser = user;
    await this.uow.run(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: { id: tokenId, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new DomainError('TOKEN_ALREADY_USED');
      await tx.user.update({
        where: { id: activeUser.id },
        data: { passwordHash, status: 'ACTIVE', failedLoginCount: 0 },
      });
      await tx.passwordHistory.create({ data: { userId: activeUser.id, passwordHash } });
      await this.outbox.add(tx, {
        type: 'user.activated',
        aggregateType: 'user',
        aggregateId: activeUser.id,
        payload: { userId: activeUser.id },
      });
    });
    return { activated: true, userId: activeUser.id };
  }

  /** US-1.3 — demande de compte publique ; réponse identique que le compte existe ou non. */
  async requestAccount(input: RequestAccountInput): Promise<{ message: string }> {
    const message = 'Votre demande est en cours de validation';
    const ctx = RequestContext.metadata();
    await this.limiter.consume(
      { name: 'request-account', limit: 5, windowSeconds: 3600 },
      ctx.ip ?? 'unknown',
    );
    if (!(await this.captcha.verify(input.captchaToken, ctx.ip))) {
      // Rejet silencieux des robots (US-1.3)
      await this.audit.record({
        action: 'access_request.captcha_failed',
        resourceType: 'access_request',
        result: 'DENIED',
      });
      return { message };
    }
    const ipHash = ctx.ip ? sha256Hex(`ip:${ctx.ip}`) : null;
    if (ipHash) {
      const pending = await this.prisma.accessRequest.count({
        where: { ipHash, status: 'PENDING' },
      });
      if (pending >= 3)
        throw new DomainError('RATE_LIMITED', 'Trop de demandes en attente de traitement', {
          retryAfter: 86_400,
        });
    }
    const exists =
      (await this.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      })) ||
      (await this.prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } }));
    if (exists) {
      await this.audit.record({
        action: 'access_request.duplicate_identifier',
        resourceType: 'access_request',
        result: 'DENIED',
      });
      return { message }; // pas de fuite d'information (US-1.3)
    }
    let target: string | null = null;
    if (input.invitationCode)
      target = await this.tontines.resolveInvitationCode(input.invitationCode);
    if (!target && input.tontineName)
      target = await this.tontines.findByExactName(input.tontineName);
    const country = countryFromPhone(input.phone) ?? ctx.country ?? null;
    try {
      await this.uow.run(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: input.email,
            phone: input.phone,
            role: 'MEMBER',
            status: 'PENDING_APPROVAL',
            firstName: input.firstName,
            lastName: input.lastName,
            countryCode: country,
            language: getCountry(country)?.language ?? 'fr',
            preferredChannel: input.preferredChannel,
          },
        });
        const req = await tx.accessRequest.create({
          data: {
            userId: u.id,
            invitationCodeHash: input.invitationCode ? sha256Hex(input.invitationCode) : null,
            requestedTontineName: input.tontineName ?? null,
            targetTontineId: target,
            ipHash,
            expiresAt: new Date(this.clock.now().getTime() + ACCESS_REQUEST_TTL_MS),
          },
        });
        await this.outbox.addMany(tx, [
          {
            type: 'user.registered',
            aggregateType: 'user',
            aggregateId: u.id,
            payload: {
              userId: u.id,
              firstName: u.firstName,
              lastName: u.lastName,
              email: u.email,
              phone: u.phone,
              country,
              language: u.language,
              role: 'MEMBER',
              preferredChannel: input.preferredChannel,
              registeredBy: null,
              tontineId: null,
            },
          },
          {
            type: 'user.approval.requested',
            aggregateType: 'user',
            aggregateId: u.id,
            payload: { userId: u.id, requestId: req.id, requestedTontineId: target },
          },
        ]);
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    return { message };
  }

  private async canDecide(actor: Actor, targetTontineId: string | null): Promise<boolean> {
    if (actor.role === 'SUPER_ADMIN') return true;
    return !!targetTontineId && (await this.tontines.isAdmin(targetTontineId, actor.userId));
  }

  /** US-10.1 / US-2.4 — liste des demandes que l'acteur peut traiter. */
  async listAccessRequests(
    actor: Actor,
    opts: { tontineId?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' },
  ) {
    let tontineFilter: object = {};
    if (actor.role !== 'SUPER_ADMIN') {
      const mine = opts.tontineId
        ? [opts.tontineId]
        : await this.tontines.tontineIdsOf(actor.userId);
      const adminOf: string[] = [];
      for (const t of mine) if (await this.tontines.isAdmin(t, actor.userId)) adminOf.push(t);
      if (opts.tontineId && adminOf.length === 0) {
        await this.denied.record('tontine', opts.tontineId, 'access-requests:not-admin');
        throw new DomainError('FORBIDDEN');
      }
      tontineFilter = { targetTontineId: { in: adminOf } };
    } else if (opts.tontineId) {
      tontineFilter = { targetTontineId: opts.tontineId };
    }
    const rows = await this.prisma.accessRequest.findMany({
      where: { status: opts.status ?? 'PENDING', ...tontineFilter },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const names = new Map<string, string>();
    for (const t of new Set(rows.map((r) => r.targetTontineId).filter((x): x is string => !!x))) {
      const d = await this.tontines.describe(t);
      if (d) names.set(t, d.name);
    }
    return {
      data: rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        requestedTontineName: r.requestedTontineName,
        targetTontine: r.targetTontineId
          ? { id: r.targetTontineId, name: names.get(r.targetTontineId) ?? null }
          : null,
        decisionReason: r.decisionReason,
        user: {
          id: r.user.id,
          firstName: r.user.firstName,
          lastName: r.user.lastName,
          email: r.user.email,
          phone: r.user.phone,
          country: r.user.countryCode,
          preferredChannel: r.user.preferredChannel,
        },
      })),
    };
  }

  /** Décision sur une demande d'accès : acceptée → activation envoyée ; refusée → motif obligatoire, archivée. */
  async decideAccessRequest(actor: Actor, requestId: string, input: AccessDecisionInput) {
    const req = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });
    if (!req) throw new DomainError('NOT_FOUND', 'Demande introuvable');
    if (!(await this.canDecide(actor, req.targetTontineId))) {
      await this.denied.record('access_request', requestId, 'not-authorized');
      throw new DomainError('FORBIDDEN');
    }
    if (req.status !== 'PENDING')
      throw new DomainError('INVALID_STATE_TRANSITION', `Demande déjà ${req.status.toLowerCase()}`);
    const now = this.clock.now();
    if (input.decision === 'APPROVE') {
      const tontineId = input.tontineId ?? req.targetTontineId;
      if (
        tontineId &&
        actor.role !== 'SUPER_ADMIN' &&
        !(await this.tontines.isAdmin(tontineId, actor.userId))
      ) {
        throw new DomainError('FORBIDDEN');
      }
      let pending!: PendingSecret;
      await this.uow.run(async (tx) => {
        const res = await tx.accessRequest.updateMany({
          where: { id: req.id, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            decidedById: actor.userId,
            decidedAt: now,
            targetTontineId: tontineId ?? null,
          },
        });
        if (res.count !== 1) throw new DomainError('CONFLICT', 'Demande déjà traitée');
        await tx.user.update({ where: { id: req.userId }, data: { status: 'PENDING_ACTIVATION' } });
        pending = await this.issueActivation(
          tx,
          req.user,
          req.user.preferredChannel === 'SMS' ? 'SMS' : 'EMAIL',
        );
        await this.outbox.add(tx, {
          type: 'user.access.decided',
          aggregateType: 'user',
          aggregateId: req.userId,
          payload: { userId: req.userId, requestId: req.id, decision: 'APPROVED', reason: null },
        });
        if (tontineId) {
          await this.outbox.add(tx, {
            type: 'member.decision',
            aggregateType: 'member',
            aggregateId: req.userId,
            payload: {
              memberId: req.userId,
              tontineId,
              decision: 'ACCEPTED',
              reason: null,
              decidedBy: actor.userId,
            },
          });
        }
        await this.audit.record(
          {
            action: 'access_request.approved',
            resourceType: 'access_request',
            resourceId: req.id,
            result: 'SUCCESS',
          },
          tx,
        );
      });
      await this.deliverActivation({ ...req.user, status: 'PENDING_ACTIVATION' }, pending);
      return { id: req.id, status: 'APPROVED', userStatus: 'PENDING_ACTIVATION' };
    }
    await this.uow.run(async (tx) => {
      const res = await tx.accessRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedById: actor.userId,
          decidedAt: now,
          decisionReason: input.reason,
        },
      });
      if (res.count !== 1) throw new DomainError('CONFLICT', 'Demande déjà traitée');
      // Données archivées (pas supprimées) : le compte passe en REJECTED.
      await tx.user.update({ where: { id: req.userId }, data: { status: 'REJECTED' } });
      await this.outbox.add(tx, {
        type: 'user.access.decided',
        aggregateType: 'user',
        aggregateId: req.userId,
        payload: {
          userId: req.userId,
          requestId: req.id,
          decision: 'REJECTED',
          reason: input.reason,
        },
      });
      if (req.targetTontineId) {
        await this.outbox.add(tx, {
          type: 'member.decision',
          aggregateType: 'member',
          aggregateId: req.userId,
          payload: {
            memberId: req.userId,
            tontineId: req.targetTontineId,
            decision: 'REJECTED',
            reason: input.reason,
            decidedBy: actor.userId,
          },
        });
      }
      await this.audit.record(
        {
          action: 'access_request.rejected',
          resourceType: 'access_request',
          resourceId: req.id,
          result: 'SUCCESS',
          metadata: { reason: input.reason },
        },
        tx,
      );
    });
    return { id: req.id, status: 'REJECTED', userStatus: 'REJECTED' };
  }

  /** US-1.3 — expiration automatique des demandes non traitées sous 30 jours. */
  @ScheduledJob({
    name: 'auth.expire-access-requests',
    cron: '0 15 2 * * *',
    description: 'Expire les demandes d’accès de plus de 30 jours',
  })
  async expireAccessRequests(): Promise<{ expired: number }> {
    const due = await this.prisma.accessRequest.findMany({
      where: { status: 'PENDING', expiresAt: { lte: this.clock.now() } },
      take: 500,
    });
    for (const r of due) {
      await this.uow.run(async (tx) => {
        const res = await tx.accessRequest.updateMany({
          where: { id: r.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        if (res.count !== 1) return;
        await tx.user.update({ where: { id: r.userId }, data: { status: 'EXPIRED' } });
        await this.outbox.add(tx, {
          type: 'user.access.decided',
          aggregateType: 'user',
          aggregateId: r.userId,
          payload: { userId: r.userId, requestId: r.id, decision: 'EXPIRED', reason: null },
        });
      });
    }
    return { expired: due.length };
  }
}
