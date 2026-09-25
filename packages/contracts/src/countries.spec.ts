import { describe, expect, it } from 'vitest';
import { baseLanguage, countryFromPhone, getCountry, isE164, normalizePhone } from './countries';
import { maskEmail, maskPhone } from './masking';

describe('Référentiel pays (US-2.1, US-9.1)', () => {
  it('déduit le pays depuis l’indicatif', () => {
    expect(countryFromPhone('+237699123445')).toBe('CM');
    expect(countryFromPhone('+225 07 12 34 56 78')).toBe('CI');
    expect(countryFromPhone('+2348012345678')).toBe('NG');
  });

  it('+1 → Canada par défaut (A-21)', () => {
    expect(countryFromPhone('+15145551234')).toBe('CA');
    expect(getCountry('CA')?.language).toBe('fr-CA');
  });

  it('renvoie undefined pour un numéro invalide ou inconnu', () => {
    expect(countryFromPhone('699123445')).toBeUndefined();
    expect(countryFromPhone('+999123456789')).toBeUndefined();
    expect(countryFromPhone(null)).toBeUndefined();
  });

  it('fournit langue et fuseau par défaut', () => {
    const cm = getCountry('cm');
    expect(cm?.language).toBe('fr-CM');
    expect(cm?.timezone).toBe('Africa/Douala');
    expect(cm?.currency).toBe('XAF');
  });

  it('normalise et valide le format E.164', () => {
    expect(normalizePhone('00237 699-12-34-45')).toBe('+237699123445');
    expect(isE164('+237699123445')).toBe(true);
    expect(isE164('+0123')).toBe(false);
  });

  it('langue de base', () => {
    expect(baseLanguage('en-CM')).toBe('en');
    expect(baseLanguage('fr-CA')).toBe('fr');
    expect(baseLanguage(undefined)).toBe('fr');
  });
});

describe('Masquage (US-2.3)', () => {
  it('masque les emails', () => {
    expect(maskEmail('jean@email.com')).toBe('j***@email.com');
    expect(maskEmail(null)).toBeNull();
  });

  it('masque les téléphones selon le format de la spec', () => {
    expect(maskPhone('+237699123445')).toBe('+237 6** *** **45');
    expect(maskPhone('+15145551234')).toBe('+1 5** *** **34');
  });
});
