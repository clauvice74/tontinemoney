import { describe, expect, it } from 'vitest';
import { amlSeverity, levelOf, maxSeverity, riskScore, violationSeverity } from './risk';

const base = {
  kycLevel: 'TIER_3' as const,
  memberStatus: 'ACTIVE',
  complianceStatus: 'COMPLIANT',
  openCases: [],
  recentViolations: 0,
};

describe('riskScore (A-41)', () => {
  it('membre vérifié TIER_3 sans alerte : 0, LOW, aucun facteur', () => {
    expect(riskScore(base)).toEqual({ score: 0, level: 'LOW', factors: [] });
  });

  it('additionne les facteurs et les trie par poids décroissant', () => {
    const r = riskScore({
      ...base,
      kycLevel: 'TIER_1',
      openCases: [{ type: 'AML_SCREENING', severity: 'HIGH' }],
      recentViolations: 2,
    });
    expect(r.score).toBe(15 + 30 + 6);
    expect(r.level).toBe('HIGH');
    expect(r.factors.map((f) => f.code)).toEqual([
      'OPEN_CASE_AML_SCREENING',
      'KYC_LEVEL',
      'RECENT_VIOLATIONS',
    ]);
  });

  it('violations plafonnées à 15 points ; score plafonné à 100', () => {
    expect(riskScore({ ...base, recentViolations: 40 }).score).toBe(15);
    const r = riskScore({
      ...base,
      kycLevel: 'NONE',
      memberStatus: 'SUSPENDED',
      complianceStatus: 'SUSPENDED',
      openCases: [
        { type: 'FRAUD', severity: 'CRITICAL' },
        { type: 'AML_SCREENING', severity: 'CRITICAL' },
      ],
      recentViolations: 10,
    });
    expect(r.score).toBe(100);
    expect(r.level).toBe('CRITICAL');
  });

  it('statut de conformité : restreint +10, non conforme +20', () => {
    expect(riskScore({ ...base, complianceStatus: 'RESTRICTED' }).score).toBe(10);
    expect(riskScore({ ...base, complianceStatus: 'NON_COMPLIANT' }).score).toBe(20);
  });

  it('bornes des niveaux', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(levelOf)).toEqual([
      'LOW',
      'LOW',
      'MEDIUM',
      'MEDIUM',
      'HIGH',
      'HIGH',
      'CRITICAL',
      'CRITICAL',
    ]);
  });
});

describe('gravité des dossiers', () => {
  it('AML : PEP moyen, sanction forte ou critique selon le score', () => {
    expect(amlSeverity('PEP', 100)).toBe('MEDIUM');
    expect(amlSeverity('OFAC', 100)).toBe('CRITICAL');
    expect(amlSeverity('UE', 80)).toBe('HIGH');
  });

  it('violations : LOW < 3 ≤ MEDIUM < 5 ≤ HIGH', () => {
    expect([1, 2, 3, 4, 5, 9].map(violationSeverity)).toEqual([
      'LOW',
      'LOW',
      'MEDIUM',
      'MEDIUM',
      'HIGH',
      'HIGH',
    ]);
  });

  it('maxSeverity ne rétrograde jamais', () => {
    expect(maxSeverity('HIGH', 'LOW')).toBe('HIGH');
    expect(maxSeverity('MEDIUM', 'CRITICAL')).toBe('CRITICAL');
  });
});
