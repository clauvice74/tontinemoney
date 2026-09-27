import { z } from 'zod';
import { COUNTRY_CODES, isE164, normalizePhone } from '../countries';

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().trim().toLowerCase().max(255).email('Format email invalide');

export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine(isE164, { message: 'Format téléphone invalide' });

export const personNameSchema = z
  .string()
  .trim()
  .min(1, 'Champ requis')
  .max(100)
  .regex(/^[\p{L}\p{M}' .-]+$/u, 'Caractères non autorisés');

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => COUNTRY_CODES.includes(c), { message: 'Pays non supporté (ISO 3166-1 alpha-2)' });

export const languageSchema = z
  .string()
  .trim()
  .regex(/^(fr|en)(-[A-Z]{2})?$/, 'Langue non supportée (fr-XX ou en-XX)');

export const timezoneSchema = z
  .string()
  .trim()
  .max(50)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Fuseau horaire IANA invalide' },
  );

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), { message: 'Date invalide' });

export const reasonSchema = z.string().trim().min(1, 'Le motif est obligatoire').max(1000);

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
