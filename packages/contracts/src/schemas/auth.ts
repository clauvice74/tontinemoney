import { z } from 'zod';
import { COMMUNICATION_CHANNELS } from '../enums';
import { passwordSchema } from '../password';
import {
  countryCodeSchema,
  emailSchema,
  languageSchema,
  personNameSchema,
  phoneSchema,
  uuidSchema,
} from './common';

/** US-1.1 — création d'un administrateur de tontine par le super-admin. */
export const createTontineAdminSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  country: countryCodeSchema,
  language: languageSchema,
  tontineName: z.string().trim().min(3).max(200),
});
export type CreateTontineAdminInput = z.infer<typeof createTontineAdminSchema>;

/** US-1.2 — inscription d'un membre par l'admin. */
export const registerMemberSchema = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    preferredChannel: z.enum(COMMUNICATION_CHANNELS),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    address: z.string().trim().max(500).optional(),
    country: countryCodeSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Au moins un identifiant requis',
      });
    }
    if (v.preferredChannel === 'SMS' && !v.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'Téléphone requis pour le canal SMS',
      });
    }
    if (v.preferredChannel === 'EMAIL' && !v.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Email requis pour le canal email',
      });
    }
  });
export type RegisterMemberInput = z.infer<typeof registerMemberSchema>;

/** US-1.3 — demande de compte (public). */
export const requestAccountSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  preferredChannel: z.enum(COMMUNICATION_CHANNELS),
  invitationCode: z.string().trim().max(64).optional(),
  tontineName: z.string().trim().max(200).optional(),
  captchaToken: z.string().min(1).max(4096),
});
export type RequestAccountInput = z.infer<typeof requestAccountSchema>;

export const identifierSchema = z.string().trim().min(3).max(255);

/** US-1.4 */
export const loginSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1).max(256),
  /**
   * « Se souvenir de moi » (A-57) : faux → cookie de session (effacé à la fermeture du
   * navigateur) ; la session serveur garde sa durée (7 jours, US-1.4). Vrai par défaut.
   */
  rememberMe: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const loginMfaSchema = z.object({
  challengeToken: z.string().min(10).max(512),
  code: z.string().trim().min(6).max(12),
});
export type LoginMfaInput = z.infer<typeof loginMfaSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10).max(512).optional() });

/** Activation par lien (48 h) ou par OTP (15 min). */
export const activateAccountSchema = z
  .object({
    token: z.string().min(10).max(512).optional(),
    identifier: identifierSchema.optional(),
    otp: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    password: passwordSchema,
  })
  .refine((v) => !!v.token || (!!v.identifier && !!v.otp), {
    message: 'Lien d’activation ou code OTP requis',
  });
export type ActivateAccountInput = z.infer<typeof activateAccountSchema>;

export const resendOtpSchema = z.object({ identifier: identifierSchema });

/** US-1.5 */
export const forgotPasswordSchema = z.object({ identifier: identifierSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(512),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** US-1.6 */
export const mfaEnableSchema = z.object({ type: z.enum(['TOTP', 'SMS']) });
export const mfaVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(256),
  code: z.string().trim().min(6).max(12),
});
export const mfaRecoveryAckSchema = z.object({ acknowledged: z.literal(true) });

/** US-10.1 — décision sur une demande d'accès. */
export const accessDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE'), tontineId: uuidSchema.optional() }),
  z.object({
    decision: z.literal('REJECT'),
    reason: z.string().trim().min(1, 'Le motif est obligatoire').max(1000),
  }),
]);
export type AccessDecisionInput = z.infer<typeof accessDecisionSchema>;

export interface AuthTokensResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  mfaType: 'TOTP' | 'SMS';
  expiresIn: number;
}
