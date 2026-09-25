import { Inject, Injectable } from '@nestjs/common';
import {
  type JwtKeyStore,
  TokenVerificationError,
  generateOpaqueToken,
  sha256Hex,
} from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { type PlatformRole } from '@tontine/contracts';
import { type TxClient, type User } from '@tontine/database';
import {
  APP_CONFIG,
  type AccessTokenVerifier,
  type Actor,
  Clock,
  DomainError,
  KvStore,
  OutboxService,
  PrismaService,
  RequestContext,
  TONTINE_ACCESS,
  type TontineAccessPort,
  UnitOfWork,
} from '@tontine/platform';
import { JWT_KEYSTORE } from './keys.provider';

/** R-AUTH-LOGIN-03 */
export const MAX_ACTIVE_SESSIONS = 5;

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
  newDevice: boolean;
}

export function deviceFingerprint(userAgent: string, ip: string): string {
  return sha256Hex(`${userAgent}|${ip}`);
}

/**
 * Émission / rotation / révocation des jetons (US-1.4) et vérification des access tokens
 * (implémente AccessTokenVerifier pour la garde globale).
 */
@Injectable()
export class TokenService implements AccessTokenVerifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly kv: KvStore,
    private readonly clock: Clock,
    @Inject(JWT_KEYSTORE) private readonly keys: JwtKeyStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TONTINE_ACCESS) private readonly tontines: TontineAccessPort,
  ) {}

  get jwks(): { keys: Array<Record<string, unknown>> } {
    return this.keys.publicJwks as unknown as { keys: Array<Record<string, unknown>> };
  }

  async signAccess(user: Pick<User, 'id' | 'role'>, sessionId: string) {
    const tontineIds = await this.tontines.tontineIdsOf(user.id);
    return this.keys.sign(
      { sub: user.id, role: user.role as PlatformRole, tontineIds, sid: sessionId },
      this.config.ACCESS_TOKEN_TTL_SECONDS,
      this.clock.now(),
    );
  }

  /** Ouvre une session (refresh token haché, lié au device) et émet l'access token. */
  async openSession(tx: TxClient, user: User, mfaUsed: boolean): Promise<IssuedTokens> {
    const now = this.clock.now();
    const { ip, userAgent } = RequestContext.metadata();
    const ua = (userAgent ?? 'unknown').slice(0, 255);
    const fingerprint = deviceFingerprint(ua, ip ?? 'unknown');
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000);
    const session = await tx.refreshSession.create({
      data: {
        userId: user.id,
        familyId: generateOpaqueToken(),
        tokenHash: sha256Hex(refreshToken),
        deviceFingerprint: fingerprint,
        userAgent: ua,
        ip: ip ?? 'unknown',
        mfaUsed,
        expiresAt,
      },
    });
    // Au-delà de 5 sessions actives, la plus ancienne est révoquée.
    const active = await tx.refreshSession.findMany({
      where: { userId: user.id, revokedAt: null, rotatedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const excess = active.length - MAX_ACTIVE_SESSIONS;
    if (excess > 0) {
      await tx.refreshSession.updateMany({
        where: { id: { in: active.slice(0, excess).map((s) => s.id) } },
        data: { revokedAt: now, revokedReason: 'MAX_SESSIONS' },
      });
    }
    const known = await tx.knownDevice.findUnique({
      where: { userId_fingerprint: { userId: user.id, fingerprint } },
    });
    if (known) await tx.knownDevice.update({ where: { id: known.id }, data: { lastSeenAt: now } });
    else await tx.knownDevice.create({ data: { userId: user.id, fingerprint } });
    const hadDevices = (await tx.knownDevice.count({ where: { userId: user.id } })) > 1;
    const access = await this.signAccess(user, session.id);
    return {
      accessToken: access.token,
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt: expiresAt,
      sessionId: session.id,
      newDevice: !known && hadDevices,
    };
  }

  /** Rotation du refresh token ; la réutilisation d'un jeton déjà tourné révoque toute la famille. */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const now = this.clock.now();
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: sha256Hex(refreshToken) },
      include: { user: true },
    });
    if (!session) throw new DomainError('INVALID_TOKEN', 'Session invalide, reconnectez-vous');
    if (session.rotatedAt || session.revokedAt) {
      if (session.rotatedAt && !session.revokedAt) {
        // Réutilisation détectée (vol probable) : révocation de toute la famille.
        await this.prisma.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'REUSE_DETECTED' },
        });
      }
      throw new DomainError('INVALID_TOKEN', 'Session invalide, reconnectez-vous');
    }
    if (session.expiresAt <= now)
      throw new DomainError('INVALID_TOKEN', 'Session expirée, reconnectez-vous');
    if (session.user.status !== 'ACTIVE') throw new DomainError('INVALID_TOKEN', 'Compte inactif');

    return this.uow.run(async (tx) => {
      // Consommation atomique (protège contre deux rafraîchissements simultanés)
      const consumed = await tx.refreshSession.updateMany({
        where: { id: session.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now, lastUsedAt: now },
      });
      if (consumed.count !== 1)
        throw new DomainError('INVALID_TOKEN', 'Session invalide, reconnectez-vous');
      const next = generateOpaqueToken();
      const replacement = await tx.refreshSession.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: sha256Hex(next),
          deviceFingerprint: session.deviceFingerprint,
          userAgent: session.userAgent,
          ip: RequestContext.metadata().ip ?? session.ip,
          mfaUsed: session.mfaUsed,
          expiresAt: session.expiresAt, // la durée de vie absolue de la famille n'est pas prolongée
        },
      });
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { replacedById: replacement.id },
      });
      const access = await this.signAccess(session.user, replacement.id);
      return {
        accessToken: access.token,
        expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: next,
        refreshExpiresAt: replacement.expiresAt,
        sessionId: replacement.id,
        newDevice: false,
      };
    });
  }

  /** Déconnexion : session révoquée + access token blacklisté (TTL = durée restante). */
  async logout(actor: Actor): Promise<void> {
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const s = await tx.refreshSession.findUnique({ where: { id: actor.sessionId } });
      if (s && !s.revokedAt) {
        await tx.refreshSession.update({
          where: { id: s.id },
          data: { revokedAt: now, revokedReason: 'LOGOUT' },
        });
        // R-AUTH-04 : la révocation invalide toute la lignée de la session du device
        await tx.refreshSession.updateMany({
          where: { familyId: s.familyId, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'LOGOUT' },
        });
      }
      await this.outbox.add(tx, {
        type: 'user.logout',
        aggregateType: 'user',
        aggregateId: actor.userId,
        payload: { userId: actor.userId, sessionId: actor.sessionId },
      });
    });
    await this.blacklist(actor.jti, actor.tokenExp);
  }

  async blacklist(jti: string, exp: number): Promise<void> {
    const ttl = Math.max(1, exp - Math.floor(this.clock.now().getTime() / 1000));
    await this.kv.set(`jwt:bl:${jti}`, '1', ttl);
  }

  /** Révoque toutes les sessions d'un utilisateur (reset de mot de passe, fraude, suspension). */
  async revokeAll(
    userId: string,
    reason: string,
    db: TxClient | PrismaService = this.prisma,
  ): Promise<number> {
    const res = await db.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
    return res.count;
  }

  /** AccessTokenVerifier — signature, expiration, blacklist, session et statut du compte. */
  async verify(token: string): Promise<Actor> {
    let claims;
    try {
      claims = await this.keys.verify(token, this.clock.now());
    } catch (e) {
      if (e instanceof TokenVerificationError && e.expired)
        throw new DomainError('INVALID_TOKEN', 'Jeton expiré');
      throw new DomainError('INVALID_TOKEN');
    }
    if (await this.kv.exists(`jwt:bl:${claims.jti}`))
      throw new DomainError('INVALID_TOKEN', 'Jeton révoqué');
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, mfaUsed: true, user: { select: { status: true, role: true } } },
    });
    // Une session tournée reste valide pour l'access token déjà émis ; une session révoquée non.
    if (!session || session.revokedAt) throw new DomainError('INVALID_TOKEN', 'Session révoquée');
    if (session.user.status !== 'ACTIVE') throw new DomainError('INVALID_TOKEN', 'Compte inactif');
    return {
      userId: claims.sub,
      role: session.user.role as PlatformRole,
      sessionId: claims.sid,
      tontineIds: claims.tontineIds,
      jti: claims.jti,
      tokenExp: claims.exp,
      mfa: session.mfaUsed,
    };
  }
}
