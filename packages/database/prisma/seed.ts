/**
 * Données de démonstration (idempotent). AUCUNE donnée réelle : identités fictives,
 * domaines `.local`, numéros de test. Mot de passe commun : Demo#Tontine2026
 *
 *   pnpm db:seed
 */
import { hash } from '@node-rs/bcrypt';
import { COUNTRIES, NOTIFICATION_CATEGORIES } from '@tontine/contracts';
import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '../src';

export const DEMO_PASSWORD = 'Demo#Tontine2026';

type Role = 'SUPER_ADMIN' | 'TONTINE_ADMIN' | 'MEMBER' | 'KYC_AGENT' | 'COMPLIANCE_AGENT';
type Kyc = 'NONE' | 'TIER_1' | 'TIER_2' | 'TIER_3';

interface DemoUser {
  key: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: Role;
  country: string;
  kycLevel: Kyc;
  memberStatus: 'ACTIVE' | 'KYC_REQUIRED' | 'PENDING';
  mfa?: 'SMS';
  depositMinor?: bigint;
}

export const DEMO_USERS: DemoUser[] = [
  {
    key: 'superadmin',
    email: 'superadmin@tontinemoney.local',
    phone: '+237600000001',
    firstName: 'Sandrine',
    lastName: 'Admin',
    role: 'SUPER_ADMIN',
    country: 'CM',
    kycLevel: 'TIER_3',
    memberStatus: 'ACTIVE',
    mfa: 'SMS',
  },
  {
    key: 'kyc',
    email: 'agent.kyc@tontinemoney.local',
    phone: '+237600000002',
    firstName: 'Karim',
    lastName: 'Verif',
    role: 'KYC_AGENT',
    country: 'CM',
    kycLevel: 'TIER_3',
    memberStatus: 'ACTIVE',
  },
  {
    key: 'compliance',
    email: 'agent.conformite@tontinemoney.local',
    phone: '+237600000009',
    firstName: 'Clarisse',
    lastName: 'Conforme',
    role: 'COMPLIANCE_AGENT',
    country: 'CM',
    kycLevel: 'TIER_3',
    memberStatus: 'ACTIVE',
  },
  {
    key: 'admin',
    email: 'admin.tontine@tontinemoney.local',
    phone: '+237600000003',
    firstName: 'Marie',
    lastName: 'Ngono',
    role: 'TONTINE_ADMIN',
    country: 'CM',
    kycLevel: 'TIER_3',
    memberStatus: 'ACTIVE',
    depositMinor: 500_000n,
  },
  {
    key: 'awa',
    email: 'awa@tontinemoney.local',
    phone: '+237600000011',
    firstName: 'Awa',
    lastName: 'Mbarga',
    role: 'MEMBER',
    country: 'CM',
    kycLevel: 'TIER_2',
    memberStatus: 'ACTIVE',
    depositMinor: 300_000n,
  },
  {
    key: 'bello',
    email: 'bello@tontinemoney.local',
    phone: '+237600000012',
    firstName: 'Bello',
    lastName: 'Issa',
    role: 'MEMBER',
    country: 'CM',
    kycLevel: 'TIER_2',
    memberStatus: 'ACTIVE',
    depositMinor: 300_000n,
  },
  {
    key: 'chantal',
    email: 'chantal@tontinemoney.local',
    phone: '+237600000013',
    firstName: 'Chantal',
    lastName: 'Fouda',
    role: 'MEMBER',
    country: 'CM',
    kycLevel: 'TIER_2',
    memberStatus: 'ACTIVE',
    depositMinor: 300_000n,
  },
  {
    key: 'david',
    email: 'david@tontinemoney.local',
    phone: '+237600000014',
    firstName: 'David',
    lastName: 'Tchami',
    role: 'MEMBER',
    country: 'CM',
    kycLevel: 'TIER_2',
    memberStatus: 'ACTIVE',
    depositMinor: 50_000n,
  },
  {
    key: 'emma',
    email: 'emma@tontinemoney.local',
    phone: '+237600000015',
    firstName: 'Emma',
    lastName: 'Nkoulou',
    role: 'MEMBER',
    country: 'CM',
    kycLevel: 'TIER_1',
    memberStatus: 'KYC_REQUIRED',
  },
  {
    key: 'felix',
    email: 'felix@tontinemoney.local',
    phone: '+2250700000016',
    firstName: 'Félix',
    lastName: 'Kouassi',
    role: 'MEMBER',
    country: 'CI',
    kycLevel: 'TIER_2',
    memberStatus: 'ACTIVE',
    depositMinor: 200_000n,
  },
];

async function upsertUser(
  prisma: PrismaClient,
  u: DemoUser,
  passwordHash: string,
): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: u.email } });
  const country = COUNTRIES[u.country]!;
  const id = existing?.id ?? randomUUID();
  if (!existing) {
    await prisma.user.create({
      data: {
        id,
        email: u.email,
        phone: u.phone,
        passwordHash,
        role: u.role,
        status: 'ACTIVE',
        firstName: u.firstName,
        lastName: u.lastName,
        countryCode: u.country,
        language: country.language,
        preferredChannel: 'SMS',
        mfaEnabled: !!u.mfa,
        mfaType: u.mfa ?? null,
      },
    });
    await prisma.passwordHistory.create({ data: { userId: id, passwordHash } });
  }
  await prisma.member.upsert({
    where: { id },
    create: {
      id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      countryCode: u.country,
      countrySource: u.kycLevel === 'TIER_2' || u.kycLevel === 'TIER_3' ? 'KYC' : 'PHONE',
      language: country.language,
      timezone: country.timezone,
      status: u.memberStatus,
      kycLevel: u.kycLevel,
      dateOfBirth: new Date('1990-05-17T00:00:00Z'),
      notificationPrefs: {
        preferredChannel: 'SMS',
        frequency: 'IMMEDIATE',
        enabledTypes: [...NOTIFICATION_CATEGORIES],
        quietHours: { start: '22:00', end: '07:00' },
      },
    },
    update: {},
  });
  const wallet = await prisma.wallet.findUnique({ where: { memberId: id } });
  if (!wallet)
    await prisma.wallet.create({
      data: { ownerType: 'MEMBER', memberId: id, currency: country.currency },
    });
  return id;
}

/** Dépôt de démonstration cohérent avec le grand livre (partie double). */
async function seedDeposit(
  prisma: PrismaClient,
  memberId: string,
  amountMinor: bigint,
): Promise<void> {
  const key = `seed-deposit-${memberId}`;
  if (await prisma.transaction.findUnique({ where: { idempotencyKey: key } })) return;
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId } });
  const clearing =
    (await prisma.wallet.findFirst({
      where: { systemCode: 'PSP_CLEARING', currency: wallet.currency },
    })) ??
    (await prisma.wallet.create({
      data: {
        ownerType: 'SYSTEM',
        systemCode: 'PSP_CLEARING',
        currency: wallet.currency,
        allowNegative: true,
      },
    }));
  await prisma.$transaction(async (tx) => {
    const trx = await tx.transaction.create({
      data: {
        idempotencyKey: key,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amountMinor,
        currency: wallet.currency,
        initiatorId: memberId,
        beneficiaryId: memberId,
        sourceWalletId: clearing.id,
        destinationWalletId: wallet.id,
        contextType: 'PAYMENT',
        description: 'Dépôt de démonstration (seed)',
        metadata: { seed: true, ip: '127.0.0.1', device: 'seed', country: 'CM' },
        validatedAt: new Date(),
        completedAt: new Date(),
      },
    });
    const c = await tx.wallet.update({
      where: { id: clearing.id },
      data: { balanceMinor: { decrement: amountMinor }, version: { increment: 1 } },
    });
    const w = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: amountMinor }, version: { increment: 1 } },
    });
    await tx.walletMovement.createMany({
      data: [
        {
          walletId: clearing.id,
          transactionId: trx.id,
          type: 'DEBIT',
          amountMinor,
          balanceAfter: c.balanceMinor,
          availableAfter: c.balanceMinor - c.blockedMinor,
          context: 'DEPOSIT',
        },
        {
          walletId: wallet.id,
          transactionId: trx.id,
          type: 'CREDIT',
          amountMinor,
          balanceAfter: w.balanceMinor,
          availableAfter: w.balanceMinor - w.blockedMinor,
          context: 'DEPOSIT',
          description: 'Dépôt de démonstration',
        },
      ],
    });
    await tx.transactionAuditLog.create({
      data: {
        transactionId: trx.id,
        action: 'SEED',
        result: 'COMPLETED',
        retainUntil: new Date(Date.now() + 7 * 365 * 86_400_000),
      },
    });
  });
}

/** Catalogue initial des règles de conformité (P2 §10.2). Montants en unités mineures. */
export const COMPLIANCE_SEED = [
  {
    country: 'CM',
    currency: 'XAF',
    daily: 1_000_000n,
    wallet: 5_000_000n,
    kyc: 'TIER_2',
    tontine: 'ALLOWED',
  },
  {
    country: 'CI',
    currency: 'XOF',
    daily: 2_000_000n,
    wallet: 10_000_000n,
    kyc: 'TIER_2',
    tontine: 'ALLOWED',
  },
  {
    country: 'NG',
    currency: 'NGN',
    daily: 50_000_000n,
    wallet: 200_000_000n,
    kyc: 'TIER_2',
    tontine: 'ALLOWED',
  },
  {
    country: 'CD',
    currency: 'USD',
    daily: 100_000n,
    wallet: 500_000n,
    kyc: 'TIER_2',
    tontine: 'ALLOWED',
  },
  {
    country: 'FR',
    currency: 'EUR',
    daily: 300_000n,
    wallet: 1_000_000n,
    kyc: 'TIER_3',
    tontine: 'CONDITIONAL',
  },
  {
    country: 'CA',
    currency: 'CAD',
    daily: 300_000n,
    wallet: 1_000_000n,
    kyc: 'TIER_3',
    tontine: 'CONDITIONAL',
  },
] as const;

const FINANCIAL_OPS = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'TONTINE_CONTRIBUTION',
  'TONTINE_PAYOUT',
] as const;

async function seedCompliance(prisma: PrismaClient): Promise<void> {
  for (const c of COMPLIANCE_SEED) {
    const rules = [
      {
        code: `${c.country}-DAILY-LIMIT`,
        ruleType: 'DAILY_LIMIT' as const,
        operationTypes: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'TONTINE_CONTRIBUTION'],
        params: { limitMinor: c.daily.toString(), currency: c.currency },
        description: `Limite de transactions journalière (${c.country})`,
      },
      {
        code: `${c.country}-MONTHLY-LIMIT`,
        ruleType: 'MONTHLY_LIMIT' as const,
        operationTypes: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'TONTINE_CONTRIBUTION'],
        params: { limitMinor: (c.daily * 20n).toString(), currency: c.currency },
        description: `Limite mensuelle (${c.country})`,
      },
      {
        code: `${c.country}-WALLET-LIMIT`,
        ruleType: 'WALLET_LIMIT' as const,
        operationTypes: ['DEPOSIT', 'TRANSFER', 'TONTINE_PAYOUT'],
        params: { limitMinor: c.wallet.toString(), currency: c.currency },
        description: `Plafond de portefeuille (${c.country})`,
      },
      {
        code: `${c.country}-KYC-${c.kyc.replace('_', '')}`,
        ruleType: 'KYC_MIN_LEVEL' as const,
        operationTypes: [...FINANCIAL_OPS],
        params: { minLevel: c.kyc },
        description: `Niveau KYC minimum ${c.kyc} (${c.country})`,
      },
      {
        code: `${c.country}-TONTINES`,
        ruleType: 'TONTINE_ALLOWED' as const,
        operationTypes: [
          'TONTINE_CREATION',
          'TONTINE_JOIN',
          'TONTINE_CONTRIBUTION',
          'TONTINE_PAYOUT',
        ],
        params:
          c.tontine === 'ALLOWED' ? { allowed: true } : { allowed: true, requiresLevel: 'TIER_3' },
        description:
          c.tontine === 'ALLOWED'
            ? 'Tontines autorisées'
            : 'Tontines autorisées sous conditions (KYC TIER_3)',
      },
    ];
    for (const r of rules) {
      const exists = await prisma.complianceRule.findUnique({ where: { code: r.code } });
      if (exists) continue;
      const rule = await prisma.complianceRule.create({
        data: {
          code: r.code,
          countryCode: c.country,
          ruleType: r.ruleType,
          operationTypes: r.operationTypes as never,
          params: r.params,
          description: r.description,
        },
      });
      await prisma.complianceRuleHistory.create({
        data: {
          ruleId: rule.id,
          version: 1,
          snapshot: r.params,
          change: 'CREATED',
          reason: 'Catalogue initial',
        },
      });
    }
  }
}

export async function seed(
  prisma: PrismaClient,
  log: (m: string) => void = console.warn,
): Promise<Record<string, string>> {
  const passwordHash = await hash(DEMO_PASSWORD, 12);
  const ids: Record<string, string> = {};
  for (const u of DEMO_USERS) ids[u.key] = await upsertUser(prisma, u, passwordHash);
  for (const u of DEMO_USERS)
    if (u.depositMinor) await seedDeposit(prisma, ids[u.key]!, u.depositMinor);
  await seedCompliance(prisma);

  // Tontine de démonstration prête à démarrer (admin + 4 membres KYC TIER_2)
  const name = 'Tontine Solidarité Douala';
  let tontine = await prisma.tontine.findFirst({ where: { name, createdById: ids['admin']! } });
  if (!tontine) {
    // Date de début = aujourd'hui : la tâche « tontines.start-due » peut la démarrer immédiatement (démo).
    const start = new Date();
    tontine = await prisma.tontine.create({
      data: {
        name,
        status: 'READY',
        contributionMinor: 50_000n,
        currency: 'XAF',
        frequency: 'MONTHLY',
        frequencyDetail: { day: 'wednesday', weekOfMonth: 1 },
        maxMembers: 12,
        startDate: new Date(start.toISOString().slice(0, 10)),
        timezone: 'Africa/Douala',
        drawMode: 'RANDOM',
        graceDays: 3,
        lateFeeBps: 500,
        suspendAfter: 2,
        defaultAfterDays: 7,
        entryFeeMinor: 0n,
        collationMinor: 0n,
        createdById: ids['admin']!,
      },
    });
    await prisma.wallet.create({
      data: { ownerType: 'TONTINE_POOL', tontineId: tontine.id, currency: 'XAF' },
    });
    await prisma.wallet.create({
      data: { ownerType: 'TONTINE_RESERVE', tontineId: tontine.id, currency: 'XAF' },
    });
    const pool = await prisma.wallet.findFirstOrThrow({
      where: { tontineId: tontine.id, ownerType: 'TONTINE_POOL' },
    });
    const reserve = await prisma.wallet.findFirstOrThrow({
      where: { tontineId: tontine.id, ownerType: 'TONTINE_RESERVE' },
    });
    await prisma.tontine.update({
      where: { id: tontine.id },
      data: { poolWalletId: pool.id, reserveWalletId: reserve.id },
    });
    await prisma.tontineMember.create({
      data: { tontineId: tontine.id, memberId: ids['admin']!, role: 'ADMIN', status: 'ACTIVE' },
    });
    for (const k of ['awa', 'bello', 'chantal', 'david']) {
      await prisma.tontineMember.create({
        data: { tontineId: tontine.id, memberId: ids[k]!, role: 'MEMBER', status: 'ACTIVE' },
      });
    }
    await prisma.tontineAccount.create({
      data: {
        tontineId: tontine.id,
        name: 'Compte principal (cotisations)',
        type: 'MAIN',
        rules: {},
        functional: true,
        walletId: pool.id,
        createdById: ids['admin']!,
      },
    });
  }
  ids['tontine'] = tontine.id;
  log(`✔ Données de démonstration prêtes (${DEMO_USERS.length} comptes, tontine « ${name} »)`);
  return ids;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL non défini');
  if (process.env['NODE_ENV'] === 'production')
    throw new Error('Seed de démonstration interdit en production');
  const prisma = createPrismaClient({ url });
  try {
    await seed(prisma);
    console.warn(`Comptes (mot de passe : ${DEMO_PASSWORD}) :`);
    for (const u of DEMO_USERS)
      console.warn(
        `  ${u.role.padEnd(13)} ${u.email}${u.mfa ? '  (MFA SMS : code visible sur GET /api/v1/dev/messages)' : ''}`,
      );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
