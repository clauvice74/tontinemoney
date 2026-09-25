import { COUNTRIES, normalizePhone } from './countries';

/** `jean.dupont@email.com` → `j***@email.com` (US-2.3). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** `+237699123445` → `+237 6** *** **45` (US-2.3). */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/^\+/, '');
  const dial =
    Object.values(COUNTRIES)
      .map((c) => c.dialCode)
      .sort((a, b) => b.length - a.length)
      .find((d) => digits.startsWith(d)) ?? digits.slice(0, Math.min(3, digits.length - 4));
  const national = digits.slice(dial.length);
  if (national.length < 4) return `+${dial} ***`;
  // Gabarit fixe : ne révèle ni la longueur ni les chiffres centraux.
  return `+${dial} ${national[0]}** *** **${national.slice(-2)}`;
}

/** Masque générique pour les logs : conserve les 2 derniers caractères. */
export function maskTail(value: string | null | undefined, visible = 2): string | null {
  if (!value) return null;
  if (value.length <= visible) return '*'.repeat(value.length);
  return `${'*'.repeat(Math.min(6, value.length - visible))}${value.slice(-visible)}`;
}
