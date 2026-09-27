import {
  COUNTRIES,
  NOTIFICATION_CATEGORIES,
  countryFromPhone,
  getCountry,
} from '@tontine/contracts';

export type CountrySource = 'KYC' | 'PROFILE' | 'PHONE' | 'IP';

/** Priorité de résolution du pays (US-9.1) : KYC > profil > téléphone > IP. */
export const COUNTRY_SOURCE_PRIORITY: Record<CountrySource, number> = {
  KYC: 4,
  PROFILE: 3,
  PHONE: 2,
  IP: 1,
};

export interface CountryCandidate {
  source: CountrySource;
  country: string | null | undefined;
}

export function resolveCountry(
  candidates: CountryCandidate[],
): { country: string; source: CountrySource } | null {
  const valid = candidates
    .filter(
      (c): c is { source: CountrySource; country: string } =>
        !!c.country && !!getCountry(c.country),
    )
    .sort((a, b) => COUNTRY_SOURCE_PRIORITY[b.source] - COUNTRY_SOURCE_PRIORITY[a.source]);
  const best = valid[0];
  return best ? { country: best.country.toUpperCase(), source: best.source } : null;
}

/** Vrai si une source nouvelle peut écraser la source actuelle. */
export function canOverrideCountry(
  current: CountrySource | null | undefined,
  incoming: CountrySource,
): boolean {
  if (!current) return true;
  return COUNTRY_SOURCE_PRIORITY[incoming] >= COUNTRY_SOURCE_PRIORITY[current];
}

export interface NotificationPrefsValue {
  preferredChannel: 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';
  frequency: 'IMMEDIATE' | 'DAILY_DIGEST';
  enabledTypes: string[];
  quietHours: { start: string; end: string } | null;
}

/** Préférences par défaut selon le pays (US-2.1) : SMS en Afrique, email ailleurs. */
export function defaultNotificationPrefs(
  country: string | null | undefined,
  preferred?: string | null,
): NotificationPrefsValue {
  const smsFirst = !country || !['FR', 'BE', 'CA'].includes(country);
  const channel =
    preferred === 'EMAIL' || preferred === 'SMS' ? preferred : smsFirst ? 'SMS' : 'EMAIL';
  return {
    preferredChannel: channel,
    frequency: 'IMMEDIATE',
    enabledTypes: [...NOTIFICATION_CATEGORIES],
    quietHours: { start: '22:00', end: '07:00' },
  };
}

export function defaultsFor(country: string | null | undefined): {
  language: string;
  timezone: string;
  currency: string | null;
} {
  const c = getCountry(country);
  if (!c) return { language: 'fr', timezone: 'UTC', currency: null };
  return { language: c.language, timezone: c.timezone, currency: c.currency };
}

export function deduceCountry(input: {
  country?: string | null;
  phone?: string | null;
  ipCountry?: string | null;
}) {
  return resolveCountry([
    { source: 'PROFILE', country: input.country },
    { source: 'PHONE', country: countryFromPhone(input.phone ?? null) },
    { source: 'IP', country: input.ipCountry },
  ]);
}

/** Complétude minimale (US-2.2 §5) : nom, prénom, pays, au moins un contact. */
export function isProfileComplete(m: {
  firstName: string;
  lastName: string;
  countryCode: string | null;
  email: string | null;
  phone: string | null;
}): boolean {
  return !!m.firstName && !!m.lastName && !!m.countryCode && (!!m.email || !!m.phone);
}

export function ageOn(dateOfBirth: string, today: string): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age;
}

export const KNOWN_COUNTRIES = Object.keys(COUNTRIES);
