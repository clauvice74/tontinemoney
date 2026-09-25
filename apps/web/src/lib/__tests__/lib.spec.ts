import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelative, fullName, isoDateFromToday } from '../format';
import { amountStep, currencyForCountry, formatMinor, isNegative, validateAmountPrecision } from '../money';
import { buildNavigation, homeFor, isActive } from '../navigation';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('money', () => {
  it('formate les montants XAF sans décimales', () => {
    expect(nbsp(formatMinor('1500000', 'XAF'))).toMatch(/1 500 000/);
  });
  it('pas de saisie selon la devise', () => {
    expect(amountStep('XAF')).toBe('1');
    expect(amountStep('EUR')).toBe('0.01');
  });
  it('refuse une précision trop fine ou un montant nul', () => {
    expect(validateAmountPrecision('10.5', 'XAF')).not.toBeNull();
    expect(validateAmountPrecision('0', 'XAF')).toBe('Le montant doit être supérieur à 0');
    expect(validateAmountPrecision('10.50', 'EUR')).toBeNull();
  });
  it('devise par défaut du pays', () => {
    expect(currencyForCountry('CI')).toBe('XOF');
    expect(currencyForCountry(null)).toBe('XAF');
  });
  it('détecte un solde négatif', () => {
    expect(isNegative({ amount: '-1', amountMinor: '-1', currency: 'XAF' })).toBe(true);
    expect(isNegative(null)).toBe(false);
  });
});

describe('format', () => {
  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2 Ko');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 Mo');
  });
  it('formatRelative', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    expect(formatRelative('2026-09-25T09:00:00Z', now)).toBe('il y a 3 h');
    expect(formatRelative('2026-09-28T12:00:00Z', now)).toBe('dans 3 j');
    expect(formatRelative(null, now)).toBe('—');
  });
  it('isoDateFromToday et fullName', () => {
    expect(isoDateFromToday(1, new Date(2026, 11, 31))).toBe('2027-01-01');
    expect(fullName({ firstName: 'Awa', lastName: null })).toBe('Awa');
    expect(fullName({})).toBe('—');
  });
});

describe('navigation', () => {
  it('page d’accueil par rôle', () => {
    expect(homeFor('SUPER_ADMIN')).toBe('/admin');
    expect(homeFor('KYC_AGENT')).toBe('/kyc-review');
    expect(homeFor('MEMBER')).toBe('/dashboard');
  });
  it('un membre ne voit pas les sections plateforme ni KYC', () => {
    const titles = buildNavigation('MEMBER', []).map((s) => s.title);
    expect(titles).toContain('Mon espace');
    expect(titles).not.toContain('Plateforme');
    expect(titles).not.toContain('Revue KYC');
  });
  it('un agent KYC voit la revue mais pas l’espace membre', () => {
    const titles = buildNavigation('KYC_AGENT', []).map((s) => s.title);
    expect(titles).toContain('Revue KYC');
    expect(titles).not.toContain('Mon espace');
  });
  it('liens des tontines administrées', () => {
    const admin = buildNavigation('TONTINE_ADMIN', [{ id: 't1', name: 'Solidarité' }]);
    const items = admin.flatMap((s) => s.items);
    expect(items.find((i) => i.href === '/tontines/t1/admin')?.label).toBe('Solidarité');
  });
  it('isActive exact / préfixe', () => {
    expect(isActive('/tontines/new', { href: '/tontines', label: '', icon: 'tontines', exact: true })).toBe(false);
    expect(isActive('/wallet/history', { href: '/wallet', label: '', icon: 'wallet' })).toBe(true);
  });
});
