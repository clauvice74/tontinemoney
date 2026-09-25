import { Inject, Injectable } from '@nestjs/common';
import {
  DataCipher,
  generateNumericOtp,
  generateRecoveryCodes,
  generateTotpSecret,
  hashSecret,
  normalizeRecoveryCode,
  resolveBcryptCost,
  totpUri,
  verifySecret,
  verifyTotp,
} from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { type MfaType } from '@tontine/contracts';
import { NotificationService } from '@tontine/notifications';
import {
  APP_CONFIG,
  type Actor,
  Clock,
  DomainError,
  OutboxService,
  PrismaService,
  UnitOfWork,
} from '@tontine/platform';
import QRCode from 'qrcode';

const SETUP_TTL_MS = 10 * 60_000;

/** Activation / désactivation du MFA et codes de récupération (US-1.6). */
@Injectable()
export class MfaService {
  private readonly cipher: DataCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.cipher = new DataCipher(config.DATA_ENCRYPTION_KEY);
  }

  private get cost(): number {
    return resolveBcryptCost(this.config.BCRYPT_COST, this.config.NODE_ENV);
  }

  /** Étape 1 : TOTP → secret 160 bits + QR code ; SMS → OTP envoyé au numéro enregistré. */
  async enable(actor: Actor, type: MfaType) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.mfaEnabled)
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'La double authentification est déjà active',
      );
    if (type === 'TOTP') {
      const secret = generateTotpSecret();
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          mfaPendingSecretEnc: this.cipher.encryptString(`TOTP:${secret}`, `mfa:${user.id}`),
        },
      });
      const uri = totpUri(secret, user.email ?? user.phone ?? user.id);
      return { type, otpauthUrl: uri, qrCodeUrl: await QRCode.toDataURL(uri), secret };
    }
    if (!user.phone)
      throw new DomainError('BUSINESS_RULE_VIOLATION', 'Aucun numéro de téléphone enregistré');
    const code = generateNumericOtp();
    await this.prisma.authToken.create({
      data: {
        createdAt: this.clock.now(),
        userId: user.id,
        type: 'MFA_SETUP_SMS',
        tokenHash: await hashSecret(code, this.cost),
        expiresAt: new Date(this.clock.now().getTime() + SETUP_TTL_MS),
      },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaPendingSecretEnc: this.cipher.encryptString('SMS:', `mfa:${user.id}`) },
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
    return { type, smsSent: true };
  }

  /** Étape 2 : confirmation par un code valide → MFA actif + 10 codes de récupération affichés une seule fois. */
  async verify(actor: Actor, code: string): Promise<{ success: true; recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.mfaPendingSecretEnc)
      throw new DomainError('INVALID_STATE_TRANSITION', 'Aucune activation en cours');
    const pending = this.cipher.decryptString(user.mfaPendingSecretEnc, `mfa:${user.id}`);
    const [kind, secret = ''] = pending.split(':') as ['TOTP' | 'SMS', string];
    let valid = false;
    if (kind === 'TOTP') {
      valid = verifyTotp(secret, code, this.clock.now());
    } else {
      const token = await this.prisma.authToken.findFirst({
        where: {
          userId: user.id,
          type: 'MFA_SETUP_SMS',
          consumedAt: null,
          expiresAt: { gt: this.clock.now() },
        },
        orderBy: { createdAt: 'desc' },
      });
      valid = !!token && (await verifySecret(code, token.tokenHash));
      if (valid && token)
        await this.prisma.authToken.update({
          where: { id: token.id },
          data: { consumedAt: this.clock.now() },
        });
    }
    if (!valid)
      throw new DomainError(
        'INVALID_MFA_CODE',
        'Code invalide, double authentification non activée',
      );
    const recoveryCodes = generateRecoveryCodes(10);
    const hashes = await Promise.all(recoveryCodes.map((c) => hashSecret(c, this.cost)));
    await this.uow.run(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          mfaType: kind,
          mfaSecretEnc:
            kind === 'TOTP' ? this.cipher.encryptString(secret, `mfa:${user.id}`) : null,
          mfaPendingSecretEnc: null,
        },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
      await this.outbox.add(tx, {
        type: 'user.mfa.enabled',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { userId: user.id, mfaType: kind },
      });
    });
    return { success: true, recoveryCodes };
  }

  private async checkCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (/^\d{6}$/.test(code) && user.mfaType === 'TOTP' && user.mfaSecretEnc) {
      return verifyTotp(
        this.cipher.decryptString(user.mfaSecretEnc, `mfa:${user.id}`),
        code,
        this.clock.now(),
      );
    }
    if (/^\d{6}$/.test(code) && user.mfaType === 'SMS') {
      const token = await this.prisma.authToken.findFirst({
        where: {
          userId,
          type: { in: ['MFA_SMS_LOGIN', 'MFA_SETUP_SMS'] },
          consumedAt: null,
          expiresAt: { gt: this.clock.now() },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (token && (await verifySecret(code, token.tokenHash))) {
        await this.prisma.authToken.update({
          where: { id: token.id },
          data: { consumedAt: this.clock.now() },
        });
        return true;
      }
      return false;
    }
    const normalized = normalizeRecoveryCode(code);
    for (const rc of await this.prisma.recoveryCode.findMany({ where: { userId, usedAt: null } })) {
      if (await verifySecret(normalized, rc.codeHash)) {
        await this.prisma.recoveryCode.update({
          where: { id: rc.id },
          data: { usedAt: this.clock.now() },
        });
        return true;
      }
    }
    return false;
  }

  /** Envoie un code SMS à la demande (désactivation / régénération pour un MFA SMS). */
  async sendSmsCode(actor: Actor): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.mfaType !== 'SMS' || !user.phone)
      throw new DomainError('BUSINESS_RULE_VIOLATION', 'MFA SMS inactif');
    const code = generateNumericOtp();
    await this.prisma.authToken.create({
      data: {
        createdAt: this.clock.now(),
        userId: user.id,
        type: 'MFA_SMS_LOGIN',
        tokenHash: await hashSecret(code, this.cost),
        expiresAt: new Date(this.clock.now().getTime() + SETUP_TTL_MS),
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

  /** Désactivation : mot de passe + code MFA valide ; déclenche une alerte. Interdite au super-admin. */
  async disable(actor: Actor, password: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.mfaEnabled || !user.mfaType)
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'La double authentification n’est pas active',
      );
    if (user.role === 'SUPER_ADMIN')
      throw new DomainError('FORBIDDEN', 'MFA obligatoire pour le super-administrateur');
    if (!(await verifySecret(password, user.passwordHash)))
      throw new DomainError('INVALID_CREDENTIALS');
    if (!(await this.checkCode(user.id, code.trim()))) throw new DomainError('INVALID_MFA_CODE');
    const mfaType = user.mfaType;
    await this.uow.run(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaType: null, mfaSecretEnc: null, mfaPendingSecretEnc: null },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await this.outbox.add(tx, {
        type: 'user.mfa.disabled',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { userId: user.id, mfaType },
      });
    });
  }

  /** Régénération des codes de récupération (obligatoire quand ils sont épuisés). */
  async regenerateRecoveryCodes(actor: Actor, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.mfaEnabled)
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'La double authentification n’est pas active',
      );
    if (!(await this.checkCode(user.id, code.trim()))) throw new DomainError('INVALID_MFA_CODE');
    const recoveryCodes = generateRecoveryCodes(10);
    const hashes = await Promise.all(recoveryCodes.map((c) => hashSecret(c, this.cost)));
    await this.uow.run(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
    });
    return { recoveryCodes };
  }

  async status(actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const left = await this.prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } });
    return {
      enabled: user.mfaEnabled,
      type: user.mfaType,
      recoveryCodesLeft: left,
      required: user.role === 'SUPER_ADMIN',
      mustRegenerate: user.mfaEnabled && left === 0,
    };
  }
}
