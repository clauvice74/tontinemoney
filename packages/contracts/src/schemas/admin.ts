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
