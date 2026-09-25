import { type ComplianceRuleType, type OperationType } from '@tontine/contracts';

export interface RuleSnapshot {
  code: string;
  countryCode: string;
  ruleType: ComplianceRuleType;
  operationTypes: OperationType[];
  params: Record<string, unknown>;
  active: boolean;
}

export interface EvaluationInput {
  operationType: OperationType;
  amountMinor: bigint;
  currency: string;
  member: { status: string; kycLevel: string; complianceStatus: string; country: string | null };
  /** Cumuls de la période pour les opérations couvertes par chaque règle (par code de règle). */
  totals: Record<string, bigint>;
  /** Solde du wallet crédité (règles WALLET_LIMIT), si l'opération crédite un wallet. */
  creditedWalletBalanceMinor?: bigint | null;
  rules: RuleSnapshot[];
}

export interface Violation {
  rule: string;
  message: string;
  limit?: string;
  current?: string;
  action: 'BLOCK' | 'SUSPEND';
}

export interface EvaluationResult {
  compliant: boolean;
  appliedRules: string[];
  violations: Violation[];
}

const KYC_ORDER = ['NONE', 'TIER_1', 'TIER_2', 'TIER_3'];
const atLeast = (level: string, min: string) => KYC_ORDER.indexOf(level) >= KYC_ORDER.indexOf(min);

function onViolation(params: Record<string, unknown>): 'BLOCK' | 'SUSPEND' {
  return params['onViolation'] === 'SUSPEND' ? 'SUSPEND' : 'BLOCK';
}

/** Opérations qui débitent le membre (soumises aux restrictions de conformité). */
const OUTFLOW: OperationType[] = ['WITHDRAWAL', 'TRANSFER', 'TONTINE_CONTRIBUTION'];

/**
 * Évaluation pure des règles de conformité (US-9.2, R-CMP-01). Aucune E/S : testable isolément.
 */
export function evaluate(input: EvaluationInput): EvaluationResult {
  const violations: Violation[] = [];
  const applied: string[] = [];
  const { member } = input;

  // R-MBR-02 : un membre suspendu ne peut effectuer aucune opération
  if (member.status === 'SUSPENDED' || member.complianceStatus === 'SUSPENDED') {
    violations.push({ rule: 'MEMBER-SUSPENDED', message: 'Membre suspendu : aucune opération possible', action: 'BLOCK' });
  }
  // R-MBR-03 : informations complètes (pays) avant toute opération financière
  if (!member.country) {
    violations.push({ rule: 'COUNTRY-UNKNOWN', message: 'Pays du membre inconnu : complétez votre profil', action: 'BLOCK' });
  }
  if (member.complianceStatus === 'RESTRICTED' && OUTFLOW.includes(input.operationType) && input.operationType !== 'TONTINE_CONTRIBUTION') {
    violations.push({ rule: 'MEMBER-RESTRICTED', message: 'Compte restreint : opération sortante interdite', action: 'BLOCK' });
  }

  const rules = input.rules.filter(
    (r) => r.active && r.countryCode === member.country && r.operationTypes.includes(input.operationType),
  );
  for (const r of rules) {
    applied.push(r.code);
    const p = r.params;
    switch (r.ruleType) {
      case 'DAILY_LIMIT':
      case 'MONTHLY_LIMIT': {
        if (p['currency'] && p['currency'] !== input.currency) break;
        const limit = BigInt(String(p['limitMinor'] ?? '0'));
        const current = input.totals[r.code] ?? 0n;
        if (current + input.amountMinor > limit) {
          violations.push({
            rule: r.code,
            message: r.ruleType === 'DAILY_LIMIT' ? 'Limite journalière dépassée' : 'Limite mensuelle dépassée',
            limit: limit.toString(),
            current: current.toString(),
            action: onViolation(p),
          });
        }
        break;
      }
      case 'WALLET_LIMIT': {
        if (input.creditedWalletBalanceMinor === undefined || input.creditedWalletBalanceMinor === null) break;
        if (p['currency'] && p['currency'] !== input.currency) break;
        const limit = BigInt(String(p['limitMinor'] ?? '0'));
        if (input.creditedWalletBalanceMinor + input.amountMinor > limit) {
          violations.push({
            rule: r.code,
            message: 'Plafond du portefeuille dépassé',
            limit: limit.toString(),
            current: input.creditedWalletBalanceMinor.toString(),
            action: onViolation(p),
          });
        }
        break;
      }
      case 'KYC_MIN_LEVEL': {
        const min = String(p['minLevel'] ?? 'TIER_2');
        if (!atLeast(member.kycLevel, min)) {
          violations.push({ rule: r.code, message: `Niveau KYC ${min} requis`, action: onViolation(p) });
        }
        break;
      }
      case 'TONTINE_ALLOWED': {
        if (p['allowed'] === false) {
          violations.push({ rule: r.code, message: 'Tontines non autorisées dans ce pays', action: onViolation(p) });
        } else if (typeof p['requiresLevel'] === 'string' && !atLeast(member.kycLevel, p['requiresLevel'])) {
          violations.push({ rule: r.code, message: `Tontines autorisées sous condition de KYC ${p['requiresLevel']}`, action: onViolation(p) });
        }
        break;
      }
      case 'OPERATION_FORBIDDEN':
        violations.push({ rule: r.code, message: 'Opération interdite dans ce pays', action: onViolation(p) });
        break;
    }
  }
  return { compliant: violations.length === 0, appliedRules: applied, violations };
}

/** Validation des paramètres selon le type de règle (US-9.3). */
export function validateParams(type: ComplianceRuleType, params: Record<string, unknown>): string | null {
  const isMinor = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v);
  switch (type) {
    case 'DAILY_LIMIT':
    case 'MONTHLY_LIMIT':
    case 'WALLET_LIMIT':
      return isMinor(params['limitMinor']) ? null : 'params.limitMinor (chaîne d’entiers en unités mineures) requis';
    case 'KYC_MIN_LEVEL':
      return KYC_ORDER.includes(String(params['minLevel'])) ? null : 'params.minLevel invalide';
    case 'TONTINE_ALLOWED':
      return typeof params['allowed'] === 'boolean' ? null : 'params.allowed (booléen) requis';
    case 'OPERATION_FORBIDDEN':
      return null;
  }
}
