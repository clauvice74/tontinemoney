import { Inject, Injectable } from '@nestjs/common';
import {
  DataCipher,
  generateNumericOtp,
  generateOpaqueToken,
  hashSecret,
  normalizeRecoveryCode,
  resolveBcryptCost,
  sha256Hex,
  verifySecret,
  verifyTotp,
} from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { type LoginInput, type LoginMfaInput, type ResetPasswordInput } from '@tontine/contracts';
import { type User } from '@tontine/database';
import { NotificationService } from '@tontine/notifications';
import {
  APP_CONFIG,
  type Actor,
  AuditService,
  Clock,
  DomainError,
  OutboxService,
  PrismaService,
  RateLimiter,
  RequestContext,
  UnitOfWork,
} from '@tontine/platform';
import { findUserByIdentifier } from './registration.service';
import { type IssuedTokens, TokenService } from './token.service';

export const LOCK_SHORT = { failures: 5, windowMs: 10 * 60_000, durationMs: 15 * 60_000 };
export const LOCK_LONG = { failures: 15, windowMs: 60 * 60_000 };
/** Échecs pris en compte pour le verrouillage (les tentatives sur compte déjà verrouillé ne comptent pas). */
const COUNTED_FAILURES = ['bad_credentials', 'bad_mfa_code'];
export const PERMANENT_LOCK = new Date('9999-12-31T00:00:00Z');
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
export const MFA_MAX_ATTEMPTS = 5;
export const RESET_TOKEN_TTL_MS = 60 * 60_000;
export const PASSWORD_HISTORY_DEPTH = 5;

export type LoginResult =
  | { kind: 'tokens'; tokens: IssuedTokens; user: User; recoveryCodesExhausted?: boolean }
  | { kind: 'mfa'; challengeToken: string; mfaType: 'TOTP' | 'SMS'; expiresIn: number };

/** Connexion, MFA, verrouillage, réinitialisation du mot de passe (US-1.4, US-1.5, US-1.6). */
@Injectable()
export class LoginService {
  private readonly cipher: DataCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.cipher = new DataCipher(config.DATA_ENCRYPTION_KEY);
  }

  private get cost(): number {
    return resolveBcryptCost(this.config.BCRYPT_COST, this.config.NODE_ENV);
  }

  decryptMfaSecret(user: Pick<User, 'id' | 'mfaSecretEnc'>): string | null {
    return user.mfaSecretEnc
      ? this.cipher.decryptString(user.mfaSecretEnc, `mfa:${user.id}`)
      : null;
  }

  private async recordAttempt(
    identifier: string,
    user: User | null,
    success: boolean,
    reason: string | null,
  ) {
    const ctx = RequestContext.metadata();
    await this.prisma.loginAttempt.create({
      data: {
        createdAt: this.clock.now(),
        userId: user?.id ?? null,
        identifierHash: sha256Hex(identifier.trim().toLowerCase()),
        ip: ctx.ip ?? 'unknown',
        userAgent: (ctx.userAgent ?? 'unknown').slice(0, 255),
        success,
        reason,
      },
    });
    // R-AUTH-07 : toute tentative est journalisée
    await this.audit.record({
      action: success ? 'auth.login.success' : 'auth.login.failure',
      resourceType: 'user',
      resourceId: user?.id ?? null,
      result: success ? 'SUCCESS' : 'DENIED',
      metadata: reason ? { reason } : {},
      actorId: user?.id ?? null,
    });
  }

  /** Applique la politique de verrouillage après un échec (5 / 10 min → 15 min ; 15 / 1 h → verrouillage). */
  private async onFailure(user: User): Promise<void> {
    const now = this.clock.now();
    const [short, long] = await Promise.all([
      this.prisma.loginAttempt.count({
        where: {
          userId: user.id,
          success: false,
          reason: { in: COUNTED_FAILURES },
          createdAt: { gte: new Date(now.getTime() - LOCK_SHORT.windowMs) },
        },
      }),
      this.prisma.loginAttempt.count({
        where: {
          userId: user.id,
          success: false,
          reason: { in: COUNTED_FAILURES },
          createdAt: { gte: new Date(now.getTime() - LOCK_LONG.windowMs) },
        },
      }),
    ]);
    if (long >= LOCK_LONG.failures) {
      await this.uow.run(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            lockedUntil: PERMANENT_LOCK,
            lockReason: 'TOO_MANY_ATTEMPTS',
            failedLoginCount: long,
          },
        });
        await this.outbox.add(tx, {
          type: 'user.locked',
          aggregateType: 'user',
          aggregateId: user.id,
          payload: { userId: user.id, reason: 'TOO_MANY_ATTEMPTS', attemptCount: long },
        });
      });
    } else if (short >= LOCK_SHORT.failures) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lockedUntil: new Date(now.getTime() + LOCK_SHORT.durationMs),
          lockReason: 'TEMPORARY',
          failedLoginCount: short,
        },
      });
    } else {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: short } });
    }
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const ctx = RequestContext.metadata();
    await this.limiter.consume(
      { name: 'login:ip', limit: 10, windowSeconds: 60 },
      ctx.ip ?? 'unknown',
    );
    const user = await findUserByIdentifier(this.prisma, input.identifier);
    const now = this.clock.now();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.recordAttempt(input.identifier, user, false, 'locked');
      throw new DomainError('ACCOUNT_LOCKED', 'Compte temporairement verrouillé', {
        lockedUntil:
          user.lockedUntil.getTime() >= PERMANENT_LOCK.getTime()
            ? null
            : user.lockedUntil.toISOString(),
      });
    }
    const ok = await verifySecret(input.password, user?.passwordHash ?? null);
    if (!user || !ok) {
      await this.recordAttempt(input.identifier, user, false, 'bad_credentials');
      if (user) await this.onFailure(user);
      // R-AUTH-LOGIN-01 : message générique
      throw new DomainError('INVALID_CREDENTIALS');
    }
    if (user.status !== 'ACTIVE') {
      await this.recordAttempt(input.identifier, user, false, `status_${user.status}`);
      throw new DomainError(
        'FORBIDDEN',
        'Compte non actif : activez votre compte ou contactez votre administrateur',
      );
    }
    if (user.mfaEnabled && user.mfaType) {
      const challenge = generateOpaqueToken();
      const record = await this.prisma.authToken.create({
        data: {
          createdAt: now,
          userId: user.id,
          type: 'MFA_CHALLENGE',
          tokenHash: sha256Hex(challenge),
          expiresAt: new Date(now.getTime() + MFA_CHALLENGE_TTL_MS),
        },
      });
      if (user.mfaType === 'SMS') {
        const code = generateNumericOtp();
        await this.prisma.authToken.create({
          data: {
            createdAt: now,
            userId: user.id,
            type: 'MFA_SMS_LOGIN',
            tokenHash: await hashSecret(code, this.cost),
            expiresAt: new Date(now.getTime() + MFA_CHALLENGE_TTL_MS),
            metadata: { challengeId: record.id },
          },
        });
        await this.notifications.sendDirect({
          to: { phone: user.phone },
          userId: user.id,
          template: 'auth.mfa_sms_code',
          vars: { code },
          language: user.language,
          country: user.countryCode,
          channels: ['SMS'],
        });
      }
      return {
        kind: 'mfa',
        challengeToken: challenge,
        mfaType: user.mfaType,
        expiresIn: MFA_CHALLENGE_TTL_MS / 1000,
      };
    }
    return { kind: 'tokens', tokens: await this.completeLogin(user, false), user };
  }

  private async completeLogin(user: User, mfaUsed: boolean): Promise<IssuedTokens> {
    const now = this.clock.now();
    const ctx = RequestContext.metadata();
    const issued = await this.uow.run(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lockReason: null, lastLoginAt: now },
      });
      const t = await this.tokens.openSession(tx, user, mfaUsed);
      await this.outbox.add(tx, {
        type: 'user.login',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: {
          userId: user.id,
          ip: ctx.ip ?? 'unknown',
          userAgent: ctx.userAgent ?? 'unknown',
          mfaUsed,
          newDevice: t.newDevice,
        },
      });
      return t;
    });
    await this.recordAttempt(user.email ?? user.phone ?? user.id, user, true, null);
    return issued;
  }

  async loginMfa(
    input: LoginMfaInput,
  ): Promise<{ tokens: IssuedTokens; user: User; recoveryCodesExhausted: boolean }> {
    const now = this.clock.now();
    const challenge = await this.prisma.authToken.findFirst({
      where: { tokenHash: sha256Hex(input.challengeToken), type: 'MFA_CHALLENGE' },
      include: { user: true },
    });
    if (!challenge || challenge.consumedAt || challenge.revokedAt)
      throw new DomainError('INVALID_TOKEN', 'Défi MFA invalide');
    if (challenge.expiresAt <= now)
      throw new DomainError('TOKEN_EXPIRED', 'Défi MFA expiré, reconnectez-vous');
    const user = challenge.user;
    const code = input.code.trim();
    let valid = false;
    let usedRecovery = false;
    if (/^\d{6}$/.test(code)) {
      if (user.mfaType === 'TOTP') {
        const secret = this.decryptMfaSecret(user);
        valid = !!secret && verifyTotp(secret, code, now);
      } else {
        const sms = await this.prisma.authToken.findFirst({
          where: {
            userId: user.id,
            type: 'MFA_SMS_LOGIN',
            consumedAt: null,
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: 'desc' },
        });
        valid = !!sms && (await verifySecret(code, sms.tokenHash));
        if (valid && sms)
          await this.prisma.authToken.update({ where: { id: sms.id }, data: { consumedAt: now } });
      }
    } else {
      const normalized = normalizeRecoveryCode(code);
      const codes = await this.prisma.recoveryCode.findMany({
        where: { userId: user.id, usedAt: null },
      });
      for (const rc of codes) {
        if (await verifySecret(normalized, rc.codeHash)) {
          // Code de récupération : usage unique, invalidé immédiatement
          const res = await this.prisma.recoveryCode.updateMany({
            where: { id: rc.id, usedAt: null },
            data: { usedAt: now },
          });
          valid = res.count === 1;
          usedRecovery = valid;
          break;
        }
      }
    }
    if (!valid) {
      const attempts = challenge.attempts + 1;
      await this.prisma.authToken.update({
        where: { id: challenge.id },
        data: { attempts, ...(attempts >= MFA_MAX_ATTEMPTS ? { revokedAt: now } : {}) },
      });
      await this.recordAttempt(user.email ?? user.id, user, false, 'bad_mfa_code');
      await this.onFailure(user);
      throw new DomainError('INVALID_MFA_CODE');
    }
    const consumed = await this.prisma.authToken.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new DomainError('INVALID_TOKEN', 'Défi MFA déjà utilisé');
    let exhausted = false;
    if (usedRecovery) {
      const left = await this.prisma.recoveryCode.count({
        where: { userId: user.id, usedAt: null },
      });
      if (left === 0) {
        exhausted = true;
        await this.uow.run((tx) =>
          this.outbox.add(tx, {
            type: 'user.mfa.recovery.exhausted',
            aggregateType: 'user',
            aggregateId: user.id,
            payload: { userId: user.id },
          }),
        );
      }
    }
    return {
      tokens: await this.completeLogin(user, true),
      user,
      recoveryCodesExhausted: exhausted,
    };
  }

  /** US-1.5 — réponse toujours identique ; 3 demandes / heure / identifiant. */
  async forgotPassword(identifier: string): Promise<void> {
    const res = await this.limiter.hit(
      { name: 'forgot-password', limit: 3, windowSeconds: 3600 },
      sha256Hex(identifier.trim().toLowerCase()),
    );
    if (!res.allowed) return; // silencieux : pas de fuite d'information
    const user = await findUserByIdentifier(this.prisma, identifier);
    if (!user || user.status !== 'ACTIVE') return;
    const token = generateOpaqueToken();
    const now = this.clock.now();
    await this.prisma.authToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET', consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.prisma.authToken.create({
      data: {
        createdAt: now,
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      },
    });
    await this.notifications.sendDirect({
      to: { email: user.email, phone: user.phone },
      userId: user.id,
      template: 'auth.password_reset_link',
      vars: { lien: `${this.config.APP_PUBLIC_URL}/reset-password/${token}` },
      language: user.language,
      country: user.countryCode,
      channels: user.email ? ['EMAIL'] : ['SMS'],
    });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const now = this.clock.now();
    const token = await this.prisma.authToken.findFirst({
      where: { tokenHash: sha256Hex(input.token), type: 'PASSWORD_RESET' },
      include: { user: true },
    });
    if (!token) throw new DomainError('INVALID_TOKEN', 'Lien de réinitialisation invalide');
    if (token.consumedAt) throw new DomainError('TOKEN_ALREADY_USED');
    if (token.revokedAt || token.expiresAt <= now) throw new DomainError('TOKEN_EXPIRED');
    const history = await this.prisma.passwordHistory.findMany({
      where: { userId: token.userId },
      orderBy: { createdAt: 'desc' },
      take: PASSWORD_HISTORY_DEPTH,
    });
    for (const h of history) {
      if (await verifySecret(input.newPassword, h.passwordHash))
        throw new DomainError('PASSWORD_REUSED');
    }
    const passwordHash = await hashSecret(input.newPassword, this.cost);
    await this.uow.run(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: { id: token.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new DomainError('TOKEN_ALREADY_USED');
      await tx.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: token.user.lockReason === 'TEMPORARY' ? null : token.user.lockedUntil,
        },
      });
      await tx.passwordHistory.create({ data: { userId: token.userId, passwordHash } });
      // Toutes les sessions (tous les devices) sont fermées
      await this.tokens.revokeAll(token.userId, 'PASSWORD_RESET', tx);
      await this.outbox.add(tx, {
        type: 'user.password.reset',
        aggregateType: 'user',
        aggregateId: token.userId,
        payload: { userId: token.userId },
      });
    });
  }

  /** R-AUTH-LOGIN-02 — déverrouillage par un administrateur. */
  async unlock(actor: Actor, userId: string, reason: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new DomainError('NOT_FOUND', 'Utilisateur introuvable');
    await this.uow.run(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { lockedUntil: null, lockReason: null, failedLoginCount: 0 },
      });
      await this.outbox.add(tx, {
        type: 'user.unlocked',
        aggregateType: 'user',
        aggregateId: userId,
        payload: { userId, unlockedBy: actor.userId },
      });
      await this.audit.record(
        {
          action: 'user.unlocked',
          resourceType: 'user',
          resourceId: userId,
          result: 'SUCCESS',
          metadata: { reason },
        },
        tx,
      );
    });
  }
}
