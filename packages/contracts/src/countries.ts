import { type CurrencyCode } from './money';
import { type KycDocumentType } from './enums';

/**
 * Référentiel pays (US-2.1, US-3.1, US-9.1) : indicatif E.164, devise, langue et fuseau par défaut,
 * pièces d'identité acceptées. Table de configuration statique ; les règles réglementaires
 * dynamiques vivent dans le domaine Conformité.
 */
export interface CountryInfo {
  code: string;
  nameFr: string;
  nameEn: string;
  dialCode: string;
  currency: CurrencyCode;
  language: string;
  languages: string[];
  timezone: string;
  kycDocuments: KycDocumentType[];
  /** Documents recto seul (pas de verso). */
  singleSidedDocuments: KycDocumentType[];
}

const AFRICA_FR_DOCS: KycDocumentType[] = ['CNI', 'PASSPORT', 'DRIVING_LICENSE'];

export const COUNTRIES: Record<string, CountryInfo> = {
  CM: {
    code: 'CM',
    nameFr: 'Cameroun',
    nameEn: 'Cameroon',
    dialCode: '237',
    currency: 'XAF',
    language: 'fr-CM',
    languages: ['fr-CM', 'en-CM'],
    timezone: 'Africa/Douala',
    kycDocuments: AFRICA_FR_DOCS,
    singleSidedDocuments: ['PASSPORT'],
  },
  CI: {
    code: 'CI',
    nameFr: "Côte d'Ivoire",
    nameEn: "Côte d'Ivoire",
    dialCode: '225',
    currency: 'XOF',
    language: 'fr-CI',
    languages: ['fr-CI'],
    timezone: 'Africa/Abidjan',
    kycDocuments: AFRICA_FR_DOCS,
    singleSidedDocuments: ['PASSPORT'],
  },
  SN: {
    code: 'SN',
    nameFr: 'Sénégal',
    nameEn: 'Senegal',
    dialCode: '221',
    currency: 'XOF',
    language: 'fr-SN',
    languages: ['fr-SN'],
    timezone: 'Africa/Dakar',
    kycDocuments: AFRICA_FR_DOCS,
    singleSidedDocuments: ['PASSPORT'],
  },
  GA: {
    code: 'GA',
    nameFr: 'Gabon',
    nameEn: 'Gabon',
    dialCode: '241',
    currency: 'XAF',
    language: 'fr-GA',
    languages: ['fr-GA'],
    timezone: 'Africa/Libreville',
    kycDocuments: AFRICA_FR_DOCS,
    singleSidedDocuments: ['PASSPORT'],
  },
  BJ: {
    code: 'BJ',
    nameFr: 'Bénin',
    nameEn: 'Benin',
    dialCode: '229',
    currency: 'XOF',
    language: 'fr-BJ',
    languages: ['fr-BJ'],
    timezone: 'Africa/Porto-Novo',
    kycDocuments: AFRICA_FR_DOCS,
    singleSidedDocuments: ['PASSPORT'],
  },
  TG: {
    code: 'TG',
    nameFr: 'Togo',
    nameEn: 'Togo',
    dialCode: '228',
    currency: 'XOF',
    language: 'fr-TG',
    languages: ['fr-TG'],
    timezone: 'Africa/Lome',
    kycDocuments: AFRICA_FR_DOCS,
    singleSidedDocuments: ['PASSPORT'],
  },
  CD: {
    code: 'CD',
    nameFr: 'RD Congo',
    nameEn: 'DR Congo',
    dialCode: '243',
    currency: 'USD',
    language: 'fr-CD',
    languages: ['fr-CD'],
    timezone: 'Africa/Kinshasa',
    kycDocuments: ['VOTER_CARD', 'PASSPORT', 'DRIVING_LICENSE'],
    singleSidedDocuments: ['PASSPORT'],
  },
  NG: {
    code: 'NG',
    nameFr: 'Nigeria',
    nameEn: 'Nigeria',
    dialCode: '234',
    currency: 'NGN',
    language: 'en-NG',
    languages: ['en-NG'],
    timezone: 'Africa/Lagos',
    kycDocuments: ['NIN_SLIP', 'PASSPORT', 'VOTER_CARD'],
    singleSidedDocuments: ['PASSPORT', 'NIN_SLIP'],
  },
  GH: {
    code: 'GH',
    nameFr: 'Ghana',
    nameEn: 'Ghana',
    dialCode: '233',
    currency: 'GHS',
    language: 'en-GH',
    languages: ['en-GH'],
    timezone: 'Africa/Accra',
    kycDocuments: ['PASSPORT', 'VOTER_CARD', 'DRIVING_LICENSE'],
    singleSidedDocuments: ['PASSPORT'],
  },
  RW: {
    code: 'RW',
    nameFr: 'Rwanda',
    nameEn: 'Rwanda',
    dialCode: '250',
    currency: 'RWF',
    language: 'fr-RW',
    languages: ['fr-RW', 'en-RW'],
    timezone: 'Africa/Kigali',
    kycDocuments: ['CNI', 'PASSPORT', 'DRIVING_LICENSE'],
    singleSidedDocuments: ['PASSPORT'],
  },
  KE: {
    code: 'KE',
    nameFr: 'Kenya',
    nameEn: 'Kenya',
    dialCode: '254',
    currency: 'KES',
    language: 'en-KE',
    languages: ['en-KE'],
    timezone: 'Africa/Nairobi',
    kycDocuments: ['CNI', 'PASSPORT'],
    singleSidedDocuments: ['PASSPORT'],
  },
  FR: {
    code: 'FR',
    nameFr: 'France',
    nameEn: 'France',
    dialCode: '33',
    currency: 'EUR',
    language: 'fr-FR',
    languages: ['fr-FR'],
    timezone: 'Europe/Paris',
    kycDocuments: ['CNI', 'PASSPORT', 'RESIDENCE_PERMIT'],
    singleSidedDocuments: ['PASSPORT'],
  },
  BE: {
    code: 'BE',
    nameFr: 'Belgique',
    nameEn: 'Belgium',
    dialCode: '32',
    currency: 'EUR',
    language: 'fr-BE',
    languages: ['fr-BE'],
    timezone: 'Europe/Brussels',
    kycDocuments: ['CNI', 'PASSPORT', 'RESIDENCE_PERMIT'],
    singleSidedDocuments: ['PASSPORT'],
  },
  CA: {
    code: 'CA',
    nameFr: 'Canada',
    nameEn: 'Canada',
    dialCode: '1',
    currency: 'CAD',
    language: 'fr-CA',
    languages: ['fr-CA', 'en-CA'],
    timezone: 'America/Toronto',
    kycDocuments: ['PASSPORT', 'DRIVING_LICENSE', 'RESIDENCE_PERMIT'],
    singleSidedDocuments: ['PASSPORT'],
  },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES);
export const SUPPORTED_LANGUAGES = ['fr', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function getCountry(code: string | null | undefined): CountryInfo | undefined {
  if (!code) return undefined;
  return COUNTRIES[code.toUpperCase()];
}

/** Indicatif « +1 » partagé : le Canada est le défaut (A-21). */
const DIAL_DEFAULTS: Record<string, string> = { '1': 'CA' };

const DIAL_INDEX: Array<[string, string]> = Object.values(COUNTRIES)
  .map((c): [string, string] => [c.dialCode, DIAL_DEFAULTS[c.dialCode] ?? c.code])
  .sort((a, b) => b[0].length - a[0].length);

export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function isE164(phone: string): boolean {
  return E164_PATTERN.test(phone);
}

/** Normalise un numéro (espaces, tirets, parenthèses retirés ; « 00 » → « + »). */
export function normalizePhone(raw: string): string {
  let v = raw.replace(/[\s\-().]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return v;
}

/** Déduit le pays d'un numéro E.164 par correspondance du plus long indicatif (ITU-T E.164). */
export function countryFromPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const normalized = normalizePhone(phone);
  if (!isE164(normalized)) return undefined;
  const digits = normalized.slice(1);
  for (const [dial, code] of DIAL_INDEX) {
    if (digits.startsWith(dial)) return code;
  }
  return undefined;
}

/** Langue de base (« fr » / « en ») d'une étiquette BCP 47. */
export function baseLanguage(tag: string | null | undefined): SupportedLanguage {
  const base = (tag ?? 'fr').slice(0, 2).toLowerCase();
  return base === 'en' ? 'en' : 'fr';
}

/** Vrai si le document ne comporte qu'un recto pour ce pays. */
export function isSingleSided(country: string, doc: KycDocumentType): boolean {
  return getCountry(country)?.singleSidedDocuments.includes(doc) ?? false;
}
