import {
  CURRENCY_CODES,
  type CurrencyCode,
  type MoneyView,
  currencyExponent,
  formatMoney,
  getCountry,
  isCurrencyCode,
  toMinor,
} from '@tontine/contracts';

export { CURRENCY_CODES, type CurrencyCode };

/**
 * Formate un montant en unités mineures (chaîne ou bigint) pour l'affichage :
 * séparateurs de milliers français, décimales selon la devise (aucune pour XAF/XOF/RWF).
 */
export function formatMinor(minor: string | bigint, currency: string): string {
  try {
    const value = typeof minor === 'bigint' ? minor : BigInt(minor);
    return formatMoney(value, currency, 'fr-FR');
  } catch {
    return `${String(minor)} ${currency}`;
  }
}

/** Formate un `MoneyView` renvoyé par l'API (`amountMinor` fait foi). */
export function formatMoneyView(money: MoneyView | null | undefined): string {
  if (!money) return '—';
  if (money.amountMinor !== undefined && money.amountMinor !== null && money.amountMinor !== '') {
    return formatMinor(money.amountMinor, money.currency);
  }
  return formatAmount(money.amount, money.currency);
}

/** Formate une chaîne décimale en unités majeures (« 1500 », « 12.5 »). */
export function formatAmount(amount: string, currency: string): string {
  try {
    return formatMoney(toMinor(amount, currency), currency, 'fr-FR');
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Nombre de décimales autorisées pour la saisie d'un montant dans la devise. */
export function currencyDecimals(currency: string): number {
  return isCurrencyCode(currency) ? currencyExponent(currency) : 2;
}

/** Pas de saisie HTML (`step`) adapté à la devise : 1 pour XAF, 0.01 pour EUR. */
export function amountStep(currency: string): string {
  const d = currencyDecimals(currency);
  return d === 0 ? '1' : `0.${'0'.repeat(d - 1)}1`;
}

/** Vérifie qu'une saisie respecte la précision de la devise ; renvoie un message sinon. */
export function validateAmountPrecision(amount: string, currency: string): string | null {
  try {
    const minor = toMinor(amount, currency);
    if (minor <= 0n) return 'Le montant doit être supérieur à 0';
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Montant invalide';
  }
}

/** Devise par défaut d'un pays (US-4.1 : auto-remplie selon le pays). */
export function currencyForCountry(country: string | null | undefined): CurrencyCode {
  return getCountry(country)?.currency ?? 'XAF';
}

export function isNegative(money: MoneyView | null | undefined): boolean {
  return !!money && money.amountMinor.startsWith('-');
}

/** Montant saisi → unités mineures, ou null s'il est vide ou invalide pour la devise. */
export function inputToMinor(amount: string | undefined, currency: string): bigint | null {
  if (!amount || validateAmountPrecision(amount, currency)) return null;
  try {
    const minor = toMinor(amount, currency);
    return minor > 0n ? minor : null;
  } catch {
    return null;
  }
}

/** `MoneyView` construit à partir d'unités mineures (affichage via `Amount`). */
export function moneyOf(minor: bigint, currency: string): MoneyView {
  return { amount: '', amountMinor: minor.toString(), currency };
}

/** Unités mineures d'un `MoneyView` (0 si absent). */
export function minorOf(money: MoneyView | null | undefined): bigint {
  return BigInt(money?.amountMinor ?? '0');
}
