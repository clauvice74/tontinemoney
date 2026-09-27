import { describe, expect, it } from 'vitest';
import { MEMBER_TRANSITIONS, transition } from './member-status';
import {
  ageOn,
  canOverrideCountry,
  deduceCountry,
  defaultsFor,
  isProfileComplete,
  resolveCountry,
} from './profile';

describe('Transitions de statut membre (US-2.6)', () => {
  it.each([
    ['KYC_REQUIRED', 'kyc.verified', 'ACTIVE'],
    ['KYC_IN_REVIEW', 'kyc.verified', 'ACTIVE'],
    ['KYC_IN_REVIEW', 'kyc.rejected', 'KYC_REJECTED'],
    ['KYC_REQUIRED', 'kyc.review.required', 'KYC_IN_REVIEW'],
    ['ACTIVE', 'fraud.user.flagged', 'SUSPENDED'],
    ['KYC_REQUIRED', 'compliance.user.suspended', 'SUSPENDED'],
    ['PENDING', 'profile.completed', 'KYC_REQUIRED'],
    ['KYC_REJECTED', 'kyc.submitted', 'KYC_IN_REVIEW'],
    ['SUSPENDED', 'admin.reactivate', 'ACTIVE'],
    ['ACTIVE', 'kyc.duplicate.detected', 'PENDING_REVIEW'],
  ] as const)('%s + %s → %s', (from, trigger, to) => {
    expect(transition(from, trigger)).toEqual({ ok: true, to });
  });

  it.each([
    ['ACTIVE', 'kyc.verified'],
    ['SUSPENDED', 'fraud.user.flagged'],
    ['SUSPENDED', 'compliance.user.suspended'],
    ['KYC_REQUIRED', 'kyc.rejected'],
    ['ACTIVE', 'profile.completed'],
  ] as const)('%s + %s est ignoré (transition invalide)', (from, trigger) => {
    expect(transition(from, trigger).ok).toBe(false);
  });

  it('chaque déclencheur a une cible', () => {
    for (const rule of Object.values(MEMBER_TRANSITIONS)) expect(rule.to).toBeTruthy();
  });
});

describe('Pays (US-9.1)', () => {
  it('priorité KYC > profil > téléphone > IP', () => {
    expect(
      resolveCountry([
        { source: 'IP', country: 'FR' },
        { source: 'PHONE', country: 'CM' },
      ]),
    ).toEqual({ country: 'CM', source: 'PHONE' });
    expect(
      resolveCountry([
        { source: 'PROFILE', country: 'CI' },
        { source: 'KYC', country: 'SN' },
      ]),
    ).toEqual({ country: 'SN', source: 'KYC' });
    expect(resolveCountry([{ source: 'IP', country: 'ZZ' }])).toBeNull();
  });

  it('une source de moindre priorité ne peut pas écraser le pays KYC', () => {
    expect(canOverrideCountry('KYC', 'PROFILE')).toBe(false);
    expect(canOverrideCountry('PHONE', 'PROFILE')).toBe(true);
    expect(canOverrideCountry(null, 'IP')).toBe(true);
  });

  it('déduit le pays du téléphone si absent (US-2.1)', () => {
    expect(deduceCountry({ phone: '+237699123445' })).toEqual({ country: 'CM', source: 'PHONE' });
    expect(deduceCountry({ phone: '+15145551234' })).toEqual({ country: 'CA', source: 'PHONE' });
    expect(deduceCountry({})).toBeNull();
    expect(defaultsFor('CM')).toEqual({
      language: 'fr-CM',
      timezone: 'Africa/Douala',
      currency: 'XAF',
    });
  });
});

describe('Profil', () => {
  it('complétude minimale', () => {
    expect(
      isProfileComplete({
        firstName: 'A',
        lastName: 'B',
        countryCode: 'CM',
        email: null,
        phone: '+237699000000',
      }),
    ).toBe(true);
    expect(
      isProfileComplete({
        firstName: 'A',
        lastName: 'B',
        countryCode: null,
        email: 'a@b.c',
        phone: null,
      }),
    ).toBe(false);
  });

  it('calcul de l’âge', () => {
    expect(ageOn('2008-09-25', '2026-09-24')).toBe(17);
    expect(ageOn('2008-09-24', '2026-09-24')).toBe(18);
  });
});
