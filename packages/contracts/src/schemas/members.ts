import { z } from 'zod';
import { GENDERS, KYC_LEVELS, MEMBER_STATUSES, NOTIFICATION_CATEGORIES } from '../enums';
import {
  countryCodeSchema,
  emailSchema,
  isoDateSchema,
  languageSchema,
  personNameSchema,
  phoneSchema,
  reasonSchema,
  timezoneSchema,
} from './common';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue HH:MM');

/** US-2.2 — mise à jour du profil (tous champs optionnels, version obligatoire). */
export const updateProfileSchema = z
  .object({
    version: z.number().int().positive(),
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    country: countryCodeSchema.optional(),
    region: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    address: z.string().trim().max(500).optional(),
    dateOfBirth: isoDateSchema.optional(),
    gender: z.enum(GENDERS).optional(),
    language: languageSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** US-8.5 — préférences de notification. */
export const notificationPrefsSchema = z
  .object({
    preferredChannel: z.enum(['SMS', 'EMAIL', 'PUSH', 'IN_APP']),
    frequency: z.enum(['IMMEDIATE', 'DAILY_DIGEST']).default('IMMEDIATE'),
    enabledTypes: z.array(z.enum(NOTIFICATION_CATEGORIES)).max(NOTIFICATION_CATEGORIES.length),
    quietHours: z.object({ start: hhmm, end: hhmm }).nullable(),
  })
  .strict();
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

/** US-2.3 — liste des membres d'une tontine. */
export const listMembersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
  kycLevel: z.enum(KYC_LEVELS).optional(),
  registeredFrom: isoDateSchema.optional(),
  registeredTo: isoDateSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z
    .enum(['name_asc', 'name_desc', 'registered_desc', 'registered_asc', 'status'])
    .default('name_asc'),
  membership: z.enum(['ACTIVE', 'PENDING_APPROVAL', 'ALL']).default('ALL'),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

/** US-2.4 — décision de l'admin sur un membre en attente. */
export const memberDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('ACCEPT') }),
  z.object({ decision: z.literal('REJECT'), reason: reasonSchema }),
]);
export type MemberDecisionInput = z.infer<typeof memberDecisionSchema>;

export const suspendMemberSchema = z.object({ reason: reasonSchema });
