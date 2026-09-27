/**
 * Score de risque d'un membre (A-41). Indicateur d'aide à la décision pour le personnel :
 * il ne déclenche aucune action automatique (les suspensions restent pilotées par les règles
 * de conformité, la revue KYC et le signalement de fraude).
 */

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskLevel = Severity;

export interface RiskInput {
  kycLevel: 'NONE' | 'TIER_1' | 'TIER_2' | 'TIER_3';
  memberStatus: string;
  complianceStatus: string;
  openCases: Array<{ type: string; severity: Severity }>;
  /** Violations de règles sur les 30 derniers jours. */
  recentViolations: number;
}

export interface RiskFactor {
  code: string;
  points: number;
  detail: string;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export const KYC_POINTS: Record<RiskInput['kycLevel'], number> = {
  NONE: 25,
  TIER_1: 15,
  TIER_2: 5,
  TIER_3: 0,
};
export const CASE_POINTS: Record<Severity, number> = { LOW: 5, MEDIUM: 15, HIGH: 30, CRITICAL: 50 };
export const VIOLATION_POINTS = 3;
export const VIOLATION_CAP = 15;

export function levelOf(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

export function riskScore(input: RiskInput): RiskResult {
  const factors: RiskFactor[] = [];
  const add = (code: string, points: number, detail: string) => {
    if (points > 0) factors.push({ code, points, detail });
  };

  add('KYC_LEVEL', KYC_POINTS[input.kycLevel], `Niveau de vérification ${input.kycLevel}`);
  for (const c of input.openCases)
    add(`OPEN_CASE_${c.type}`, CASE_POINTS[c.severity], `Dossier ouvert ${c.type} (${c.severity})`);
  add(
    'RECENT_VIOLATIONS',
    Math.min(input.recentViolations * VIOLATION_POINTS, VIOLATION_CAP),
    `${input.recentViolations} violation(s) de règles sur 30 jours`,
  );
  if (input.complianceStatus === 'RESTRICTED' || input.complianceStatus === 'UNDER_REVIEW')
    add('COMPLIANCE_STATUS', 10, `Statut de conformité ${input.complianceStatus}`);
  if (input.complianceStatus === 'NON_COMPLIANT' || input.complianceStatus === 'SUSPENDED')
    add('COMPLIANCE_STATUS', 20, `Statut de conformité ${input.complianceStatus}`);
  if (input.memberStatus === 'SUSPENDED') add('MEMBER_SUSPENDED', 10, 'Compte suspendu');

  const score = Math.min(
    100,
    factors.reduce((sum, f) => sum + f.points, 0),
  );
  return { score, level: levelOf(score), factors: factors.sort((a, b) => b.points - a.points) };
}

/** Gravité d'une correspondance AML : sanctions quasi certaines = CRITICAL, PEP = MEDIUM. */
export function amlSeverity(listName: string, score: number): Severity {
  if (listName === 'PEP') return 'MEDIUM';
  return score >= 90 ? 'CRITICAL' : 'HIGH';
}

/** Gravité d'un dossier de violations selon leur nombre (5 = seuil de suspension, US-9.4). */
export function violationSeverity(count: number): Severity {
  if (count >= 5) return 'HIGH';
  if (count >= 3) return 'MEDIUM';
  return 'LOW';
}

const RANK: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export function maxSeverity(a: Severity, b: Severity): Severity {
  return RANK.indexOf(a) >= RANK.indexOf(b) ? a : b;
}
