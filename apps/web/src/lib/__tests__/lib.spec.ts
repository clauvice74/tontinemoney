import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelative, fullName, isoDateFromToday } from '../format';
import {
  amountStep,
  currencyForCountry,
  formatMinor,
  isNegative,
  validateAmountPrecision,
} from '../money';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { translate } from '../i18n';
import { type NavItem, buildNavigation, homeFor, isActive } from '../navigation';

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
    expect(homeFor('COMPLIANCE_AGENT')).toBe('/kyc-review/aml');
    expect(homeFor('MEMBER')).toBe('/dashboard');
  });
  const hrefs = (items: NavItem[]): string[] =>
    items.flatMap((i) => [i.href, ...hrefs(i.children ?? [])]);

  it('membre : sidebar Accueil, Tontines, Wallet ; barre basse à 5 entrées ; ni plateforme ni KYC', () => {
    const nav = buildNavigation('MEMBER', []);
    expect(nav.primary.slice(0, 3).map((i) => i.label)).toEqual([
      'nav.home',
      'nav.tontines',
      'nav.wallet',
    ]);
    expect(nav.bottom.map((i) => i.label)).toEqual([
      'nav.home',
      'nav.tontines',
      'nav.wallet',
      'nav.notifications',
      'nav.profile',
    ]);
    expect(hrefs(nav.primary)).not.toContain('/admin/users');
    expect(hrefs(nav.primary)).not.toContain('/kyc-review');
    expect(nav.account.map((i) => i.href)).toEqual(['/profile', '/kyc', '/security']);
  });
  it('administrateur de tontine : Reporting et Administration (ses tontines)', () => {
    const nav = buildNavigation('TONTINE_ADMIN', [{ id: 't1', name: 'Solidarité' }]);
    const labels = nav.primary.map((i) => i.label);
    expect(labels).toContain('nav.reporting');
    expect(labels).toContain('nav.administration');
    const admin = nav.primary.find((i) => i.label === 'nav.administration');
    expect(admin?.children?.find((c) => c.href === '/tontines/t1/admin')?.text).toBe('Solidarité');
  });
  it('agent KYC : revue KYC, pas d’espace membre ni de barre basse', () => {
    const nav = buildNavigation('KYC_AGENT', []);
    expect(hrefs(nav.primary)).toContain('/kyc-review/duplicates');
    expect(hrefs(nav.primary)).not.toContain('/wallet');
    expect(nav.bottom).toHaveLength(0);
  });
  it('agent conformité : correspondances AML uniquement', () => {
    const nav = buildNavigation('COMPLIANCE_AGENT', []);
    expect(hrefs(nav.primary)).toContain('/kyc-review/aml');
    expect(hrefs(nav.primary)).not.toContain('/kyc-review/duplicates');
    expect(hrefs(nav.primary)).not.toContain('/admin/users');
  });
  it('super-administrateur : sidebar de la charte (Accueil, Tontines, Wallet, Reporting, Administration)', () => {
    const nav = buildNavigation('SUPER_ADMIN', []);
    expect(nav.primary.slice(0, 5).map((i) => i.label)).toEqual([
      'nav.home',
      'nav.tontines',
      'nav.wallet',
      'nav.reporting',
      'nav.administration',
    ]);
    expect(hrefs(nav.primary)).toContain('/admin/audit');
  });
  it('isActive exact / préfixe', () => {
    expect(
      isActive('/tontines/new', {
        href: '/tontines',
        label: 'nav.tontines',
        icon: 'tontines',
        exact: true,
      }),
    ).toBe(false);
    expect(
      isActive('/wallet/history', { href: '/wallet', label: 'nav.wallet', icon: 'wallet' }),
    ).toBe(true);
  });
});

describe('i18n', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [`${p}${k}`] : keys(v as object, `${p}${k}.`),
    );
  it('mêmes clés en français et en anglais, aucune chaîne vide', () => {
    expect(keys(en)).toEqual(keys(fr));
    for (const d of [fr, en])
      for (const k of keys(d)) expect(translate(d, k as never).trim()).not.toBe('');
  });
  it('interpolation et repli sur la clé', () => {
    expect(translate(fr, 'nav.notificationsUnread', { count: 3 })).toBe(
      'Notifications (3 non lue(s))',
    );
    expect(translate(en, 'nav.accountMenu', { name: 'Awa' })).toBe('Account menu for Awa');
    expect(translate(fr, 'nav.inexistant' as never)).toBe('nav.inexistant');
  });
});
