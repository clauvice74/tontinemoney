import { Inject, Injectable } from '@nestjs/common';
import {
  generateNumericOtp,
  hashSecret,
  resolveBcryptCost,
  sha256Hex,
  verifySecret,
} from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { maskEmail, maskPhone } from '@tontine/contracts';
import { NotificationService } from '@tontine/notifications';
import {
  APP_CONFIG,
  AuditService,
  Clock,
  DomainError,
  PrismaService,
  RateLimiter,
  type StepUpChallenge,
  type StepUpPort,
  type StepUpPurpose,
} from '@tontine/platform';

/** Validité d'un code de confirmation (A-59). */
export const STEP_UP_TTL_MS = 5 * 60_000;
/** Codes erronés tolérés avant blocage ; durée du blocage (mêmes règles que l'activation). */
export const STEP_UP_MAX_ATTEMPTS = 3;
export const STEP_UP_LOCK_MS = 15 * 60_000;

const TEMPLATES: Record<StepUpPurpose, 'auth.step_up_withdrawal'> = {
  WITHDRAWAL: 'auth.step_up_withdrawal',
};

interface StepUpMetadata {
  purpose: StepUpPurpose;
  bindingHash: string;
}

/**
 * Confirmation des opérations sensibles par code à usage unique (A-59, retrait) : code à
 * 6 chiffres haché, lié à l'opération (empreinte des paramètres), valable 5 minutes, 3 essais
 * puis blocage 15 minutes. Envoi par SMS, ou e-mail si aucun numéro n'est enregistré.
 */
@Injectable()
export class StepUpService implements StepUpPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get cost(): number {
    return resolveBcryptCost(this.config.BCRYPT_COST, this.config.NODE_ENV);
  }

  async issue(userId: string, purpose: StepUpPurpose, binding: string): Promise<StepUpChallenge> {
    await this.limiter.consume(
      { name: `step-up:${purpose}`, limit: 5, windowSeconds: 600 },
      userId,
    );
    const now = this.clock.now();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw new DomainError('FORBIDDEN');
    const locked = await this.prisma.authToken.findFirst({
      where: { userId, type: 'STEP_UP_OTP', lockedUntil: { gt: now } },
    });
    if (locked) throw new DomainError('OTP_LOCKED');
    const channel: 'SMS' | 'EMAIL' | null = user.phone ? 'SMS' : user.email ? 'EMAIL' : null;
    if (!channel)
      throw new DomainError('BUSINESS_RULE_VIOLATION', 'Aucun numéro ni e-mail pour le code');
    const code = generateNumericOtp();
    const expiresAt = new Date(now.getTime() + STEP_UP_TTL_MS);
    const metadata: StepUpMetadata = { purpose, bindingHash: sha256Hex(binding) };
    // Un seul code actif par opération : les précédents sont révoqués.
    await this.prisma.authToken.updateMany({
      where: { userId, type: 'STEP_UP_OTP', consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const token = await this.prisma.authToken.create({
      data: {
        userId,
        type: 'STEP_UP_OTP',
        tokenHash: await hashSecret(code, this.cost),
        expiresAt,
        metadata: { ...metadata },
        createdAt: now,
      },
    });
    await this.notifications.sendDirect({
      to: channel === 'SMS' ? { phone: user.phone } : { email: user.email },
      userId,
      template: TEMPLATES[purpose],
      vars: { code },
      language: user.language,
      country: user.countryCode,
      channels: [channel],
    });
    return {
      challengeId: token.id,
      channel,
      destination: (channel === 'SMS' ? maskPhone(user.phone) : maskEmail(user.email)) ?? '',
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verify(
    userId: string,
    purpose: StepUpPurpose,
    challengeId: string,
    code: string,
    binding: string,
  ): Promise<void> {
    const now = this.clock.now();
    const token = await this.prisma.authToken.findFirst({
      where: { id: challengeId, userId, type: 'STEP_UP_OTP' },
    });
    const meta = token?.metadata as StepUpMetadata | null | undefined;
    // Défi inconnu ou émis pour une autre opération (montant, destination…) : code invalide.
    if (!token || meta?.purpose !== purpose || meta.bindingHash !== sha256Hex(binding))
      throw new DomainError('INVALID_OTP');
    if (token.lockedUntil && token.lockedUntil > now) throw new DomainError('OTP_LOCKED');
    // Déjà utilisé ou remplacé par un code plus récent.
    if (token.consumedAt || token.revokedAt) throw new DomainError('INVALID_OTP');
    if (token.expiresAt <= now) throw new DomainError('OTP_EXPIRED');
    if (!(/^\d{6}$/.test(code) && (await verifySecret(code, token.tokenHash)))) {
      const attempts = token.attempts + 1;
      const locked = attempts >= STEP_UP_MAX_ATTEMPTS;
      await this.prisma.authToken.update({
        where: { id: token.id },
        data: locked
          ? { attempts, lockedUntil: new Date(now.getTime() + STEP_UP_LOCK_MS), revokedAt: now }
          : { attempts },
      });
      if (locked) {
        await this.audit.record({
          action: 'step_up.otp_locked',
          resourceType: 'user',
          resourceId: userId,
          result: 'DENIED',
          metadata: { purpose },
        });
        throw new DomainError('OTP_LOCKED');
      }
      throw new DomainError('INVALID_OTP');
    }
    // Consommation atomique : deux requêtes simultanées ne peuvent pas utiliser le même code.
    const res = await this.prisma.authToken.updateMany({
      where: { id: token.id, consumedAt: null, revokedAt: null },
      data: { consumedAt: now },
    });
    if (res.count !== 1) throw new DomainError('INVALID_OTP');
  }
}
