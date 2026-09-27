import { describe, expect, it } from 'vitest';
import { type RuleSnapshot, evaluate, validateParams } from './evaluate';

const rules: RuleSnapshot[] = [
  {
    code: 'CM-DAILY-LIMIT',
    countryCode: 'CM',
    ruleType: 'DAILY_LIMIT',
    operationTypes: ['DEPOSIT', 'TRANSFER', 'TONTINE_CONTRIBUTION'],
    params: { limitMinor: '1000000', currency: 'XAF' },
    active: true,
  },
  {
    code: 'CM-WALLET-LIMIT',
    countryCode: 'CM',
    ruleType: 'WALLET_LIMIT',
    operationTypes: ['DEPOSIT'],
    params: { limitMinor: '5000000', currency: 'XAF' },
    active: true,
  },
  {
    code: 'CM-KYC-TIER2',
    countryCode: 'CM',
    ruleType: 'KYC_MIN_LEVEL',
    operationTypes: ['DEPOSIT', 'TRANSFER'],
    params: { minLevel: 'TIER_2' },
    active: true,
  },
  {
    code: 'FR-TONTINES',
    countryCode: 'FR',
    ruleType: 'TONTINE_ALLOWED',
    operationTypes: ['TONTINE_JOIN'],
    params: { allowed: true, requiresLevel: 'TIER_3' },
    active: true,
  },
  {
    code: 'CM-NO-WITHDRAWAL',
    countryCode: 'CM',
    ruleType: 'OPERATION_FORBIDDEN',
    operationTypes: ['WITHDRAWAL'],
    params: {},
    active: false,
  },
];
const member = {
  status: 'ACTIVE',
  kycLevel: 'TIER_2',
  complianceStatus: 'COMPLIANT',
  country: 'CM',
};

describe('Évaluation de conformité (US-9.2)', () => {
  it('conforme sous les limites', () => {
    const r = evaluate({
      operationType: 'DEPOSIT',
      amountMinor: 100_000n,
      currency: 'XAF',
      member,
      totals: { 'CM-DAILY-LIMIT': 0n },
      creditedWalletBalanceMinor: 0n,
      rules,
    });
    expect(r).toEqual({
      compliant: true,
      appliedRules: ['CM-DAILY-LIMIT', 'CM-WALLET-LIMIT', 'CM-KYC-TIER2'],
      violations: [],
    });
  });

  it('limite journalière dépassée (exemple de la spec : 980 000 + 50 000 > 1 000 000)', () => {
    const r = evaluate({
      operationType: 'TONTINE_CONTRIBUTION',
      amountMinor: 50_000n,
      currency: 'XAF',
      member,
      totals: { 'CM-DAILY-LIMIT': 980_000n },
      rules,
    });
    expect(r.compliant).toBe(false);
    expect(r.violations[0]).toMatchObject({
      rule: 'CM-DAILY-LIMIT',
      limit: '1000000',
      current: '980000',
    });
  });

  it('plafond de wallet, niveau KYC, membre suspendu, pays inconnu', () => {
    expect(
      evaluate({
        operationType: 'DEPOSIT',
        amountMinor: 1n,
        currency: 'XAF',
        member,
        totals: {},
        creditedWalletBalanceMinor: 5_000_000n,
        rules,
      }).violations[0]?.rule,
    ).toBe('CM-WALLET-LIMIT');
    expect(
      evaluate({
        operationType: 'TRANSFER',
        amountMinor: 1n,
        currency: 'XAF',
        member: { ...member, kycLevel: 'TIER_1' },
        totals: {},
        rules,
      }).violations.map((v) => v.rule),
    ).toContain('CM-KYC-TIER2');
    expect(
      evaluate({
        operationType: 'TRANSFER',
        amountMinor: 1n,
        currency: 'XAF',
        member: { ...member, status: 'SUSPENDED' },
        totals: {},
        rules,
      }).violations[0]?.rule,
    ).toBe('MEMBER-SUSPENDED');
    expect(
      evaluate({
        operationType: 'TRANSFER',
        amountMinor: 1n,
        currency: 'XAF',
        member: { ...member, country: null },
        totals: {},
        rules,
      }).violations[0]?.rule,
    ).toBe('COUNTRY-UNKNOWN');
  });

  it('tontines « sous conditions » et règles inactives', () => {
    const fr = { ...member, country: 'FR' };
    expect(
      evaluate({
        operationType: 'TONTINE_JOIN',
        amountMinor: 0n,
        currency: 'EUR',
        member: fr,
        totals: {},
        rules,
      }).compliant,
    ).toBe(false);
    expect(
      evaluate({
        operationType: 'TONTINE_JOIN',
        amountMinor: 0n,
        currency: 'EUR',
        member: { ...fr, kycLevel: 'TIER_3' },
        totals: {},
        rules,
      }).compliant,
    ).toBe(true);
    expect(
      evaluate({
        operationType: 'WITHDRAWAL',
        amountMinor: 1n,
        currency: 'XAF',
        member,
        totals: {},
        rules,
      }).compliant,
    ).toBe(true);
  });

  it('validation des paramètres par type', () => {
    expect(validateParams('DAILY_LIMIT', { limitMinor: '100' })).toBeNull();
    expect(validateParams('DAILY_LIMIT', { limitMinor: 100 })).not.toBeNull();
    expect(validateParams('KYC_MIN_LEVEL', { minLevel: 'TIER_9' })).not.toBeNull();
  });
});
