import { z } from 'zod';
import { DRAW_MODES, INCOMPLETE_POLICIES, TONTINE_FREQUENCIES } from '../enums';
import { amountStringSchema, currencySchema } from '../money';
import { emailSchema, isoDateSchema, phoneSchema, reasonSchema, uuidSchema } from './common';

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_VALUES = WEEKDAYS;

/**
 * Détail de fréquence (P2 §4.8) :
 *  - WEEKLY / BIWEEKLY : `{ day }`
 *  - MONTHLY : `{ day, weekOfMonth: 1..4 | -1 }` (n-ième jour de semaine) ou `{ lastDayOfMonth: true }`
 *  - BIMONTHLY : `{}` (15 et dernier jour du mois, A-27)
 */
export const frequencyDetailSchema = z
  .object({
    day: z.enum(WEEKDAYS).optional(),
    weekOfMonth: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)])
      .optional(),
    lastDayOfMonth: z.boolean().optional(),
  })
  .strict();
export type FrequencyDetail = z.infer<typeof frequencyDetailSchema>;

export const penaltyRulesSchema = z
  .object({
    graceDays: z.number().int().min(0).max(30),
    lateFeePercent: z.number().min(0).max(100),
    suspendAfter: z.number().int().min(1).max(12),
    defaultAfterDays: z.number().int().min(1).max(60).default(7),
  })
  .strict();
export type PenaltyRules = z.infer<typeof penaltyRulesSchema>;

/** US-4.1 — création d'une tontine. */
export const createTontineSchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    type: z.literal('SIMPLE_ROTATIVE').default('SIMPLE_ROTATIVE'),
    contributionAmount: amountStringSchema,
    currency: currencySchema.optional(),
    frequency: z.enum(TONTINE_FREQUENCIES),
    frequencyDetail: frequencyDetailSchema.default({}),
    maxMembers: z.number().int().min(3).max(50),
    startDate: isoDateSchema,
    drawMode: z.enum(DRAW_MODES),
    penaltyRules: penaltyRulesSchema,
    entryFee: amountStringSchema.optional(),
    collation: amountStringSchema.optional(),
    incompletePolicy: z.enum(INCOMPLETE_POLICIES).default('POSTPONE'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.frequency === 'WEEKLY' || v.frequency === 'BIWEEKLY') && !v.frequencyDetail.day) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['frequencyDetail', 'day'],
        message: 'Jour de la semaine requis',
      });
    }
    if (
      v.frequency === 'MONTHLY' &&
      !v.frequencyDetail.lastDayOfMonth &&
      (!v.frequencyDetail.day || v.frequencyDetail.weekOfMonth === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['frequencyDetail'],
        message: 'Préciser le jour et la semaine du mois, ou le dernier jour du mois',
      });
    }
  });
export type CreateTontineInput = z.infer<typeof createTontineSchema>;

/** US-4.2 — invitations. */
export const createInvitationSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('EMAIL'), email: emailSchema }),
  z.object({ channel: z.literal('PHONE'), phone: phoneSchema }),
  z.object({ channel: z.literal('LINK') }),
]);
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const respondInvitationSchema = z.object({ accept: z.boolean() });

/**
 * FIXED_ORDER — ordre de passage. Avant démarrage : tous les membres actifs ; après : uniquement
 * les passages futurs (R-TON-08), d'où un minimum de 1.
 */
export const drawOrderSchema = z.object({ memberIds: z.array(uuidSchema).min(1).max(50) });

/** PRIORITY_NEED — demande prioritaire et désignation (A-15). */
export const priorityRequestSchema = z.object({ reason: z.string().trim().min(10).max(1000) });
export const designateBeneficiarySchema = z.object({ memberId: uuidSchema });

export const pauseTontineSchema = z.object({ reason: reasonSchema });
export const forcePayoutSchema = z.object({ reason: reasonSchema });

export const payContributionSchema = z.object({}).strict();

export const listTontinesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
});
