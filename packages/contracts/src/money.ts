import { z } from 'zod';

/**
 * Représentation monétaire (A-13) : entiers en unités mineures (`bigint`).
 * Aucun `number` flottant n'est utilisé pour un montant.
 */

/** Exposants ISO 4217 des devises supportées. */
export const CURRENCY_EXPONENTS = {
  XAF: 0,
  XOF: 0,
  NGN: 2,
  GHS: 2,
  USD: 2,
  EUR: 2,
  CAD: 2,
  CDF: 2,
  RWF: 0,
  KES: 2,
} as const;

export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;
export const CURRENCY_CODES = Object.keys(CURRENCY_EXPONENTS) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, value);
}

export function currencyExponent(currency: string): number {
  if (!isCurrencyCode(currency)) {
    throw new MoneyError(`Devise non supportée : ${currency}`);
  }
  return CURRENCY_EXPONENTS[currency];
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,14})(\.\d+)?$/;

/**
 * Convertit une chaîne décimale en unités majeures (« 12.50 ») en unités mineures (1250n).
 * Rejette toute précision supérieure à l'exposant de la devise, les signes, exposants et espaces.
 */
export function toMinor(amount: string, currency: string): bigint {
  const exponent = currencyExponent(currency);
  const trimmed = amount.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new MoneyError(`Montant invalide : « ${amount} »`);
  }
  const [intPart = '0', fracPart = ''] = trimmed.split('.');
  const frac = fracPart;
  if (frac.length > exponent) {
    throw new MoneyError(
      `Précision trop élevée pour ${currency} (${exponent} décimale(s) maximum)`,
    );
  }
  const padded = frac.padEnd(exponent, '0');
  return BigInt(intPart) * 10n ** BigInt(exponent) + (padded ? BigInt(padded) : 0n);
}

/** Convertit des unités mineures en chaîne décimale en unités majeures. */
export function fromMinor(minor: bigint, currency: string): string {
  const exponent = currencyExponent(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  if (exponent === 0) return `${negative ? '-' : ''}${abs.toString()}`;
  const base = 10n ** BigInt(exponent);
  const intPart = abs / base;
  const fracPart = (abs % base).toString().padStart(exponent, '0');
  return `${negative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

/** Formatage lisible pour l'affichage (séparateurs de milliers, locale). */
export function formatMoney(minor: bigint, currency: string, locale = 'fr-FR'): string {
  const exponent = currencyExponent(currency);
  const major = fromMinor(minor, currency);
  const [i = '0', f] = major.replace('-', '').split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, locale.startsWith('fr') ? ' ' : ',');
  const sign = minor < 0n ? '-' : '';
  const decimalSep = locale.startsWith('fr') ? ',' : '.';
  const body = exponent > 0 && f ? `${grouped}${decimalSep}${f}` : grouped;
  return `${sign}${body} ${currency}`;
}

/**
 * Pourcentage appliqué à un montant, arrondi à l'unité mineure inférieure (au bénéfice du membre).
 * `percentBps` est exprimé en points de base (5 % = 500).
 */
export function applyPercentBps(minor: bigint, percentBps: number): bigint {
  if (!Number.isInteger(percentBps) || percentBps < 0) {
    throw new MoneyError('Pourcentage invalide');
  }
  return (minor * BigInt(percentBps)) / 10_000n;
}

/** Convertit un pourcentage décimal (« 5 », « 2.5 ») en points de base. */
export function percentToBps(percent: number): number {
  const bps = Math.round(percent * 100);
  if (bps < 0 || bps > 10_000) throw new MoneyError('Pourcentage hors bornes (0-100)');
  return bps;
}

export const currencySchema = z
  .string()
  .length(3)
  .transform((v) => v.toUpperCase())
  .refine(isCurrencyCode, { message: 'Devise non supportée' });

/** Montant saisi : chaîne décimale positive stricte. */
export const amountStringSchema = z
  .string()
  .trim()
  .regex(AMOUNT_PATTERN, 'Montant invalide (format attendu : 1500 ou 12.50)');

/** Montant + devise, converti en unités mineures après validation de la précision. */
export const moneyInputSchema = z
  .object({ amount: amountStringSchema, currency: currencySchema })
  .transform((v, ctx) => {
    try {
      const minor = toMinor(v.amount, v.currency);
      if (minor <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['amount'],
          message: 'Le montant doit être > 0',
        });
        return z.NEVER;
      }
      return { currency: v.currency as CurrencyCode, minor };
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: (e as Error).message,
      });
      return z.NEVER;
    }
  });

export interface MoneyView {
  amount: string;
  amountMinor: string;
  currency: string;
}

export function moneyView(minor: bigint, currency: string): MoneyView {
  return { amount: fromMinor(minor, currency), amountMinor: minor.toString(), currency };
}
