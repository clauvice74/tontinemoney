import { z } from 'zod';
import { KYC_DOCUMENT_TYPES, KYC_REJECT_CATEGORIES } from '../enums';

export const KYC_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const KYC_MIN_WIDTH = 1000;
export const KYC_MIN_HEIGHT = 600;
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_MIME = ['image/jpeg', 'image/png'] as const;

/** US-3.1 — métadonnées accompagnant l'upload multipart. */
export const kycSubmitSchema = z.object({
  documentType: z.enum(KYC_DOCUMENT_TYPES),
  captureSource: z.literal('CAMERA', { errorMap: () => ({ message: 'Le selfie doit provenir de la caméra' }) }),
  livenessToken: z.string().min(8).max(512),
});
export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

/** A-03 — demande de passage au niveau 3. */
export const kycTier3Schema = z.object({
  incomeSource: z.string().trim().min(3).max(500),
  captureSource: z.literal('CAMERA'),
  livenessToken: z.string().min(8).max(512),
});

/** US-3.3 — décision d'un agent KYC. */
export const kycDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE'), annotation: z.string().trim().min(10, 'Annotation de 10 caractères minimum').max(2000) }),
  z.object({
    action: z.literal('REJECT'),
    category: z.enum(KYC_REJECT_CATEGORIES),
    comment: z.string().trim().min(1, 'Commentaire obligatoire').max(2000),
  }),
  z.object({ action: z.literal('REQUEST_SUPPLEMENT'), comment: z.string().trim().min(1).max(2000) }),
]);
export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;

export const duplicateResolutionSchema = z.object({
  resolution: z.enum(['CONFIRMED', 'DISMISSED']),
  comment: z.string().trim().min(1).max(2000),
});

export const amlResolutionSchema = z.object({
  resolution: z.enum(['CONFIRMED_MATCH', 'FALSE_POSITIVE']),
  comment: z.string().trim().min(1).max(2000),
});
