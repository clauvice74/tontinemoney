import { createHash } from 'node:crypto';
import { type ImageInfo } from '../image';

/**
 * Interfaces des fournisseurs KYC (prompt §9) et adaptateurs simulés DÉTERMINISTES.
 * Les adaptateurs réels (Smile Identity, Onfido, Jumio) implémenteraient ces mêmes interfaces.
 *
 * Pilotage des scénarios de test : un fichier peut contenir le marqueur ASCII
 * `SIM:cle=valeur;cle2` (ex. `SIM:facematch=72;aml=hit;blur`). Une vraie photo n'en contient pas :
 * le comportement par défaut est « tout passe » (face match 92 %).
 */
export function simMarkers(...files: Array<Buffer | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    if (!f) continue;
    const m = /SIM:([A-Za-z0-9=;,._:+-]+)/.exec(f.toString('latin1'));
    if (!m?.[1]) continue;
    for (const part of m[1].split(';')) {
      const [k, v = 'true'] = part.split('=');
      if (k) out[k.toLowerCase()] = v;
    }
  }
  return out;
}

export class ProviderUnavailableError extends Error {
  constructor(provider: string) {
    super(`Fournisseur ${provider} indisponible`);
    this.name = 'ProviderUnavailableError';
  }
}

export interface KycSubject {
  memberId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  country: string | null;
  documentType: string;
  today: string;
}

export interface CheckResult {
  outcome: 'PASS' | 'REVIEW' | 'FAIL';
  score?: number;
  details: Record<string, unknown>;
}

export interface ExtractedFields {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  documentNumber: string;
  expiresAt: string;
  nationality: string | null;
}

export interface AmlHit {
  listName: string;
  entryId: string;
  entryName: string;
  entryCountry: string | null;
  entryReason: string;
  entryAddedAt: string;
  score: number;
}

// ------------------------------------------------------------------ interfaces
export abstract class DocumentQualityProvider {
  abstract check(image: Buffer, info: ImageInfo): Promise<CheckResult>;
}
export abstract class OcrProvider {
  abstract extract(front: Buffer, back: Buffer | null, subject: KycSubject): Promise<ExtractedFields>;
}
export abstract class FaceMatchProvider {
  abstract compare(selfie: Buffer, documentFront: Buffer): Promise<{ score: number }>;
}
export abstract class BiometricTemplateProvider {
  /** Empreinte biométrique (gabarit) du visage ; comparée aux autres membres. */
  abstract template(selfie: Buffer): Promise<string>;
  abstract similarity(a: string, b: string): number;
}
export abstract class AmlScreeningProvider {
  /** OFAC, ONU, UE, Interpol et PEP (US-3.5). */
  abstract screen(fullName: string, dateOfBirth: string | null): Promise<AmlHit[]>;
}
export abstract class TamperDetectionProvider {
  abstract detect(front: Buffer): Promise<{ tampered: boolean; signals: string[] }>;
}

// ------------------------------------------------------------------ utilitaires
export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const dp = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array<number>(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
  }
  return dp[s.length]![t.length]!;
}

export function normalizeName(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ adaptateurs simulés
export class SimulatedQualityProvider extends DocumentQualityProvider {
  async check(image: Buffer, info: ImageInfo): Promise<CheckResult> {
    const m = simMarkers(image);
    if (m['provider-down']) throw new ProviderUnavailableError('quality');
    const sharpness = m['blur'] ? 12 : 88;
    const brightness = m['dark'] ? 8 : m['overexposed'] ? 97 : 55;
    const failures: string[] = [];
    if (sharpness < 40) failures.push('image floue');
    if (brightness < 20) failures.push('image trop sombre');
    if (brightness > 90) failures.push('image surexposée');
    if (info.width < 1000 || info.height < 600) failures.push('résolution insuffisante');
    return {
      outcome: failures.length ? 'FAIL' : 'PASS',
      score: sharpness,
      details: { sharpness, brightness, width: info.width, height: info.height, failures, recommendation: failures.length ? 'Merci de soumettre une nouvelle photo nette et bien éclairée' : null },
    };
  }
}

export class SimulatedOcrProvider extends OcrProvider {
  async extract(front: Buffer, back: Buffer | null, subject: KycSubject): Promise<ExtractedFields> {
    const m = simMarkers(front, back);
    if (m['ocr-down']) throw new ProviderUnavailableError('ocr');
    const expiresAt = m['expired'] ? addDays(subject.today, -1) : m['expiring'] ? addDays(subject.today, Number(m['expiring'])) : addDays(subject.today, 5 * 365);
    return {
      firstName: m['ocrfirst'] ?? subject.firstName,
      lastName: m['ocrlast'] ?? subject.lastName,
      dateOfBirth: subject.dateOfBirth ?? '1990-01-01',
      documentNumber: `${subject.documentType.slice(0, 2)}${createHash('sha256').update(front).digest('hex').slice(0, 9).toUpperCase()}`,
      expiresAt,
      nationality: m['country'] ?? subject.country,
    };
  }
}

export class SimulatedFaceMatchProvider extends FaceMatchProvider {
  async compare(selfie: Buffer, documentFront: Buffer): Promise<{ score: number }> {
    const m = simMarkers(selfie, documentFront);
    if (m['face-down']) throw new ProviderUnavailableError('face-match');
    return { score: m['facematch'] ? Number(m['facematch']) : 92 };
  }
}

export class SimulatedBiometricProvider extends BiometricTemplateProvider {
  async template(selfie: Buffer): Promise<string> {
    const m = simMarkers(selfie);
    // `face=<id>` simule le même visage sur deux selfies différents
    return m['face'] ? `face:${m['face']}` : `sha:${createHash('sha256').update(selfie).digest('hex')}`;
  }

  similarity(a: string, b: string): number {
    return a === b ? 97 : 12;
  }
}

export class SimulatedTamperDetection extends TamperDetectionProvider {
  async detect(front: Buffer): Promise<{ tampered: boolean; signals: string[] }> {
    const m = simMarkers(front);
    const signals = ['tampered', 'screenshot', 'photocopy'].filter((k) => m[k]);
    return { tampered: signals.length > 0, signals };
  }
}

/** Liste de test embarquée — identités entièrement fictives (aucune donnée réelle). */
export const TEST_WATCHLIST: Array<Omit<AmlHit, 'score'> & { dateOfBirth?: string }> = [
  { listName: 'OFAC', entryId: 'OFAC-TEST-001', entryName: 'Viktor Contrebandier', entryCountry: 'XX', entryReason: 'Sanctions (fictif)', entryAddedAt: '2024-03-01' },
  { listName: 'ONU', entryId: 'UN-TEST-017', entryName: 'Ambroise Sanction', entryCountry: 'XX', entryReason: 'Résolution du Conseil de sécurité (fictif)', entryAddedAt: '2023-11-15' },
  { listName: 'UE', entryId: 'EU-TEST-042', entryName: 'Nadia Blanchiment', entryCountry: 'XX', entryReason: 'Gel des avoirs (fictif)', entryAddedAt: '2025-06-30' },
  { listName: 'INTERPOL', entryId: 'IP-TEST-007', entryName: 'Oscar Fugitif', entryCountry: 'XX', entryReason: 'Notice rouge (fictif)', entryAddedAt: '2022-01-20' },
  { listName: 'PEP', entryId: 'PEP-TEST-100', entryName: 'Paul Expose', entryCountry: 'CM', entryReason: 'Personne politiquement exposée (fictif)', entryAddedAt: '2021-05-05' },
];

export class SimulatedAmlProvider extends AmlScreeningProvider {
  /** Entrées ajoutées dynamiquement (simulation de mise à jour des listes, batch US-3.5). */
  private readonly extra: typeof TEST_WATCHLIST = [];

  addEntry(entry: (typeof TEST_WATCHLIST)[number]): void {
    this.extra.push(entry);
  }

  async screen(fullName: string, _dateOfBirth: string | null): Promise<AmlHit[]> {
    const name = normalizeName(fullName);
    const tokens = new Set(name.split(' '));
    const hits: AmlHit[] = [];
    for (const e of [...TEST_WATCHLIST, ...this.extra]) {
      const entry = normalizeName(e.entryName);
      const sameTokens = entry.split(' ').every((t) => tokens.has(t));
      const dist = levenshtein(name, entry);
      if (sameTokens || dist <= 2) hits.push({ ...e, score: sameTokens ? 100 : 100 - dist * 10 });
    }
    return hits;
  }
}
