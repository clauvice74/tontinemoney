import { z } from 'zod';
import { MEMBER_STATUSES, MESSAGE_TEMPLATES, TONTINE_ACCOUNT_TYPES } from '../enums';
import { isoDateSchema, reasonSchema, uuidSchema } from './common';

/** US-10.2 — comptes d'une tontine. */
export const tontineAccountSchema = z.object({
  name: z.string().trim().min(3).max(100),
  type: z.enum(TONTINE_ACCOUNT_TYPES),
  rules: z
    .object({
      interestRatePercent: z.number().min(0).max(100).optional(),
      exitConditions: z.string().trim().max(1000).optional(),
    })
    .strict()
    .default({}),
});
export type TontineAccountInput = z.infer<typeof tontineAccountSchema>;

/** US-10.3 — messagerie ciblée. */
export const targetedMessageSchema = z.object({
  template: z.enum(MESSAGE_TEMPLATES),
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(1).max(1000),
  filter: z
    .object({
      memberStatuses: z.array(z.enum(MEMBER_STATUSES)).optional(),
      contributionStatus: z.enum(['LATE', 'PAID', 'PENDING']).optional(),
      memberIds: z.array(uuidSchema).max(50).optional(),
    })
    .strict()
    .default({}),
});
export type TargetedMessageInput = z.infer<typeof targetedMessageSchema>;

/** US-10.4 — rapports financiers. */
export const REPORT_KINDS = [
  'CYCLE',
  'MONTHLY',
  'ANNUAL',
  'CONTRIBUTIONS',
  'PENALTIES',
  'FINAL',
] as const;
export const reportQuerySchema = z.object({
  kind: z.enum(REPORT_KINDS),
  format: z.enum(['pdf', 'csv', 'json']).default('json'),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cycleNumber: z.coerce.number().int().min(1).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** A-14 — signalement de fraude (super-admin). */
export const flagFraudSchema = z.object({ memberId: uuidSchema, reason: reasonSchema });
export const liftSuspensionSchema = z.object({ reason: reasonSchema });
export const unlockUserSchema = z.object({ reason: reasonSchema });

/** Suspension / réactivation d'un compte par le super-admin (sessions révoquées à la suspension). */
export const userStatusSchema = z
  .object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: reasonSchema })
  .strict();
export type UserStatusInput = z.infer<typeof userStatusSchema>;

/** Rapports consolidés de la plateforme (super-admin). */
export const PLATFORM_REPORTS = [
  'financial',
  'contributions',
  'wallets',
  'compliance',
  'tontines',
] as const;
export type PlatformReport = (typeof PLATFORM_REPORTS)[number];

const platformReportFields = {
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Code devise ISO 4217 attendu')
    .transform((v) => v.toUpperCase())
    .optional(),
};

/** Période par défaut : du 1er du mois courant à aujourd'hui ; 366 jours au plus. */
const periodCheck = <T extends { from?: string | undefined; to?: string | undefined }>(
  q: T,
  ctx: z.RefinementCtx,
) => {
  if (q.from && q.to) {
    const span = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    if (span < 0)
      ctx.addIssue({ code: 'custom', path: ['to'], message: '« to » précède « from »' });
    if (span > 366)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Période limitée à 366 jours' });
  }
};

export const platformReportQuerySchema = z
  .object({ ...platformReportFields, format: z.enum(['json', 'csv', 'pdf']).default('json') })
  .strict()
  .superRefine(periodCheck);
export type PlatformReportQuery = z.infer<typeof platformReportQuerySchema>;

/** `GET /reports/export` : téléchargement CSV (défaut) ou PDF d'un rapport. */
export const platformReportExportSchema = z
  .object({
    ...platformReportFields,
    report: z.enum(PLATFORM_REPORTS),
    format: z.enum(['csv', 'pdf']).default('csv'),
  })
  .strict()
  .superRefine(periodCheck);
export type PlatformReportExport = z.infer<typeof platformReportExportSchema>;

/**
 * Paramètres modifiables à chaud par le super-admin (admin-service, A-50). Chaque clé est lue
 * par un seul service via le port CONFIGURATION ; les seuils de sécurité (OTP, verrouillage)
 * restent volontairement figés dans le code.
 */
export const CONFIGURATION_DEFINITIONS = {
  'notifications.sms.dailyLimit': {
    schema: z.number().int().min(1).max(100),
    default: 10,
    description: 'SMS non urgents par membre et par jour (au-delà : report au lendemain)',
    owner: 'notifications',
  },
  'compliance.violations.suspendAfter': {
    schema: z.number().int().min(2).max(50),
    default: 5,
    description: 'Violations de règles en 24 h avant suspension automatique (US-9.4)',
    owner: 'compliance',
  },
  'auth.sessions.max': {
    schema: z.number().int().min(1).max(20),
    default: 5,
    description: 'Sessions actives simultanées par compte (la plus ancienne est révoquée)',
    owner: 'auth',
  },
  'tontines.invitations.ttlDays': {
    schema: z.number().int().min(1).max(30),
    default: 7,
    description: 'Durée de validité d’une invitation à une tontine, en jours (US-4.2)',
    owner: 'tontines',
  },
} as const;

export type ConfigurationKey = keyof typeof CONFIGURATION_DEFINITIONS;
export type ConfigurationValues = {
  [K in ConfigurationKey]: z.infer<(typeof CONFIGURATION_DEFINITIONS)[K]['schema']>;
};
export const CONFIGURATION_KEYS = Object.keys(CONFIGURATION_DEFINITIONS) as ConfigurationKey[];

export function isConfigurationKey(key: string): key is ConfigurationKey {
  return Object.prototype.hasOwnProperty.call(CONFIGURATION_DEFINITIONS, key);
}

/** Modification d'un paramètre : valeur validée par la définition, motif, verrou optimiste. */
export const updateConfigurationSchema = z
  .object({
    value: z.unknown(),
    reason: reasonSchema,
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateConfigurationInput = z.infer<typeof updateConfigurationSchema>;
