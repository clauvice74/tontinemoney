import { type NestExpressApplication } from '@nestjs/platform-express';
import { generateTotp, generateTotpSecret, hashSecret, DataCipher } from '@tontine/auth';
import { testConfig, type AppConfig } from '@tontine/config';
import {
  getCountry,
  type KycLevel,
  type MemberStatus,
  type PlatformRole,
} from '@tontine/contracts';
import { truncateAll } from '@tontine/database';
import { SimulatedSmsProvider } from '@tontine/notifications';
import {
  FixedClock,
  JobRegistry,
  MemoryKvStore,
  OutboxRelay,
  PrismaService,
} from '@tontine/platform';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

export const PASSWORD = 'Tontine#2026-Secure';
export const START = '2026-09-24T09:00:00.000Z';

export interface TestUser {
  id: string;
  email: string;
  phone: string;
  role: PlatformRole;
  totpSecret?: string;
}

export interface CreateUserOptions {
  role?: PlatformRole;
  status?: 'ACTIVE' | 'PENDING_ACTIVATION' | 'SUSPENDED';
  memberStatus?: MemberStatus;
  kycLevel?: KycLevel;
  country?: string;
  firstName?: string;
  lastName?: string;
  mfa?: boolean;
  wallet?: boolean;
}

let phoneSeq = 100000;

export class TestContext {
  readonly prisma: PrismaService;
  readonly relay: OutboxRelay;
  readonly jobs: JobRegistry;
  readonly sms: SimulatedSmsProvider;

  constructor(
    readonly app: NestExpressApplication,
    readonly clock: FixedClock,
    readonly kv: MemoryKvStore,
    readonly config: AppConfig,
  ) {
    this.prisma = app.get(PrismaService);
    this.relay = app.get(OutboxRelay);
    this.jobs = app.get(JobRegistry);
    this.sms = app.get(SimulatedSmsProvider);
  }

  get http() {
    return request(this.app.getHttpServer());
  }

  async reset(): Promise<void> {
    await truncateAll(this.prisma);
    this.kv.clear();
    this.sms.setAvailability(true);
    this.clock.set(START);
  }

  /** Publie les événements en attente (dispatch in-process, idempotent). */
  async drain(): Promise<void> {
    await this.relay.drain();
  }

  /** Crée directement un compte + profil (+ wallet) dans l'état voulu (arrange des tests). */
  async createUser(opts: CreateUserOptions = {}): Promise<TestUser> {
    const id = randomUUID();
    const country = opts.country ?? 'CM';
    const info = getCountry(country)!;
    const phone = `+${info.dialCode}6${String(phoneSeq++).padStart(8, '0')}`;
    const email = `user-${id.slice(0, 8)}@example.test`;
    const role = opts.role ?? 'MEMBER';
    const passwordHash = await hashSecret(PASSWORD, 4);
    let totpSecret: string | undefined;
    let mfaSecretEnc: string | null = null;
    if (opts.mfa ?? role === 'SUPER_ADMIN') {
      totpSecret = generateTotpSecret();
      mfaSecretEnc = new DataCipher(this.config.DATA_ENCRYPTION_KEY).encryptString(
        totpSecret,
        `mfa:${id}`,
      );
    }
    await this.prisma.user.create({
      data: {
        id,
        email,
        phone,
        passwordHash,
        role,
        status: opts.status ?? 'ACTIVE',
        firstName: opts.firstName ?? 'Awa',
        lastName: opts.lastName ?? `Test${phoneSeq}`,
        countryCode: country,
        language: info.language,
        preferredChannel: 'SMS',
        mfaEnabled: !!totpSecret,
        mfaType: totpSecret ? 'TOTP' : null,
        mfaSecretEnc,
      },
    });
    await this.prisma.passwordHistory.create({ data: { userId: id, passwordHash } });
    await this.prisma.member.create({
      data: {
        id,
        firstName: opts.firstName ?? 'Awa',
        lastName: opts.lastName ?? `Test${phoneSeq - 1}`,
        email,
        phone,
        countryCode: country,
        countrySource: 'PHONE',
        language: info.language,
        timezone: info.timezone,
        status: opts.memberStatus ?? 'ACTIVE',
        kycLevel: opts.kycLevel ?? 'TIER_2',
        notificationPrefs: {
          preferredChannel: 'SMS',
          frequency: 'IMMEDIATE',
          enabledTypes: [
            'SECURITY',
            'ACCOUNT',
            'TONTINE',
            'PAYMENT',
            'WALLET',
            'KYC',
            'ADMIN',
            'MESSAGE',
          ],
          quietHours: null,
        },
      },
    });
    if (opts.wallet ?? true) {
      await this.prisma.wallet.create({
        data: { ownerType: 'MEMBER', memberId: id, currency: info.currency },
      });
    }
    return { id, email, phone, role, totpSecret };
  }

  /** Connexion complète (avec TOTP si MFA) ; renvoie l'access token et le cookie de refresh. */
  async login(user: TestUser, password = PASSWORD): Promise<{ token: string; cookie: string }> {
    const res = await this.http
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password });
    if (res.status !== 200) throw new Error(`login ${res.status} ${JSON.stringify(res.body)}`);
    if (res.body.mfaRequired) {
      const code = generateTotp(user.totpSecret!, this.clock.now());
      const mfa = await this.http
        .post('/api/v1/auth/login/mfa')
        .send({ challengeToken: res.body.challengeToken, code });
      if (mfa.status !== 200) throw new Error(`mfa ${mfa.status} ${JSON.stringify(mfa.body)}`);
      return { token: mfa.body.accessToken, cookie: extractCookie(mfa.headers['set-cookie']) };
    }
    return { token: res.body.accessToken, cookie: extractCookie(res.headers['set-cookie']) };
  }

  async token(user: TestUser): Promise<string> {
    return (await this.login(user)).token;
  }

  /** Dernier message simulé envoyé à un destinataire (SMS ou email). */
  async lastMessage(
    to: string,
  ): Promise<{ body: string; subject: string | null; channel: string } | null> {
    const m = await this.prisma.outboundMessage.findFirst({
      where: { recipient: to },
      orderBy: { createdAt: 'desc' },
    });
    return m ? { body: m.body, subject: m.subject, channel: m.channel } : null;
  }

  async createTontine(
    adminId: string,
    overrides: Partial<{
      name: string;
      status: 'DRAFT' | 'READY' | 'ACTIVE';
      currency: string;
      contribution: bigint;
    }> = {},
  ) {
    const t = await this.prisma.tontine.create({
      data: {
        name: overrides.name ?? `Tontine ${randomUUID().slice(0, 6)}`,
        status: overrides.status ?? 'DRAFT',
        contributionMinor: overrides.contribution ?? 50_000n,
        currency: overrides.currency ?? 'XAF',
        frequency: 'MONTHLY',
        frequencyDetail: { day: 'wednesday', weekOfMonth: 1 },
        maxMembers: 12,
        startDate: new Date('2026-11-04T00:00:00Z'),
        timezone: 'Africa/Douala',
        drawMode: 'RANDOM',
        graceDays: 3,
        lateFeeBps: 500,
        suspendAfter: 2,
        createdById: adminId,
      },
    });
    await this.prisma.tontineMember.create({
      data: { tontineId: t.id, memberId: adminId, role: 'ADMIN', status: 'ACTIVE' },
    });
    return t;
  }

  async addParticipant(
    tontineId: string,
    memberId: string,
    status: 'ACTIVE' | 'PENDING_ACTIVATION' = 'ACTIVE',
  ) {
    return this.prisma.tontineMember.create({
      data: { tontineId, memberId, role: 'MEMBER', status },
    });
  }
}

export function extractCookie(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = list.find((x) => x.startsWith('tm_rt='));
  return c ? c.split(';')[0]! : '';
}

export async function createTestContext(): Promise<TestContext> {
  const clock = new FixedClock(START);
  const kv = new MemoryKvStore(clock);
  const config = testConfig();
  const app = await createApp({ config, clock, kv });
  await app.init();
  return new TestContext(app, clock, kv, config);
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
