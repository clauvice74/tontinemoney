import { z } from 'zod';
import { MOVEMENT_CONTEXTS, MOVEMENT_TYPES, PAYMENT_METHODS } from '../enums';
import { amountStringSchema, currencySchema, isCurrencyCode } from '../money';
import { isoDateSchema, phoneSchema, reasonSchema, uuidSchema } from './common';

/** US-5.2 — historique des mouvements. */
export const walletHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  context: z.enum(MOVEMENT_CONTEXTS).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  tontineId: uuidSchema.optional(),
});
export type WalletHistoryQuery = z.infer<typeof walletHistoryQuerySchema>;

/** US-5.6 — transfert entre membres (destinataire par identifiant ou téléphone/email). */
export const transferSchema = z
  .object({
    toMemberId: uuidSchema.optional(),
    toIdentifier: z.string().trim().min(3).max(255).optional(),
    amount: amountStringSchema,
    currency: currencySchema,
    note: z.string().trim().max(140).optional(),
  })
  .refine((v) => !!v.toMemberId || !!v.toIdentifier, { message: 'Destinataire requis' });
export type TransferInput = z.infer<typeof transferSchema>;

/** US-7.1 / US-7.2 — dépôt. */
export const depositSchema = z
  .object({
    amount: amountStringSchema,
    currency: currencySchema,
    method: z.enum(PAYMENT_METHODS),
    phone: phoneSchema.optional(),
  })
  .refine((v) => v.method !== 'MOBILE_MONEY' || !!v.phone, {
    path: ['phone'],
    message: 'Numéro Mobile Money requis',
  });
export type DepositInput = z.infer<typeof depositSchema>;

/** US-7.3 — retrait. */
export const withdrawalSchema = z.object({
  amount: amountStringSchema,
  currency: currencySchema,
  method: z.literal('MOBILE_MONEY'),
  phone: phoneSchema,
});
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;

/** US-7.5 — remboursement (super-admin). */
export const refundSchema = z.object({ reason: reasonSchema });

/** Changement de statut d'un wallet (super-admin). */
export const walletStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'LOCKED', 'CLOSED']),
  reason: reasonSchema,
});

/** `POST /payments/mobile-money` : dépôt Mobile Money (méthode implicite). */
export const mobileMoneyDepositSchema = z
  .object({ amount: amountStringSchema, currency: currencySchema, phone: phoneSchema })
  .strict();
/** `POST /payments/card` : dépôt par carte (méthode implicite). */
export const cardDepositSchema = z
  .object({ amount: amountStringSchema, currency: currencySchema })
  .strict();
/** `POST /payments/refund` : remboursement, identifiant du paiement dans le corps. */
export const refundByIdSchema = z.object({ paymentId: uuidSchema, reason: reasonSchema }).strict();
/** `POST /payments/reconcile` : réconciliation PSP d'une journée (veille par défaut). */
export const pspReconcileSchema = z.object({ date: isoDateSchema.optional() }).strict();

/**
 * Notification de paiement normalisée par le Payment Gateway (signature, horodatage et
 * non-rejeu déjà vérifiés) et transmise au Payment Service par un appel interne signé.
 * Le montant et la devise sont ensuite comparés au paiement par le Payment Service.
 */
export const paymentNotificationSchema = z
  .object({
    provider: z.string().regex(/^[a-z0-9-]{2,40}$/),
    providerEventId: z.string().min(1).max(120),
    providerReference: z.string().min(1).max(120),
    merchantReference: z.string().uuid(),
    status: z.enum(['SUCCESS', 'FAILED']),
    amountMinor: z.string().regex(/^[1-9]\d{0,17}$/, 'Montant en unités mineures attendu'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine(isCurrencyCode, 'Devise non prise en charge'),
    failureReason: z.string().max(200).nullable(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type PaymentNotification = z.infer<typeof paymentNotificationSchema>;
