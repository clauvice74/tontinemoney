import { describe, expect, it } from 'vitest';
import { applyPercentBps, formatMoney, fromMinor, moneyInputSchema, percentToBps, toMinor } from './money';

describe('Money (A-13)', () => {
  it('convertit les devises sans décimales (XAF)', () => {
    expect(toMinor('50000', 'XAF')).toBe(50000n);
    expect(fromMinor(50000n, 'XAF')).toBe('50000');
  });

  it('convertit les devises à 2 décimales', () => {
    expect(toMinor('12.5', 'EUR')).toBe(1250n);
    expect(toMinor('12.05', 'NGN')).toBe(1205n);
    expect(fromMinor(1205n, 'NGN')).toBe('12.05');
    expect(fromMinor(-5n, 'USD')).toBe('-0.05');
  });

  it('rejette une précision supérieure à la devise', () => {
    expect(() => toMinor('10.5', 'XAF')).toThrow(/Précision/);
    expect(() => toMinor('1.001', 'EUR')).toThrow(/Précision/);
  });

  it('rejette les formats invalides et les montants négatifs', () => {
    for (const bad of ['-1', '1e3', '01', 'abc', '', '1.', '1,5']) {
      expect(() => toMinor(bad, 'EUR')).toThrow();
    }
  });

  it('rejette les devises non supportées', () => {
    expect(() => toMinor('1', 'BTC')).toThrow(/non supportée/);
  });

  it('ne perd pas de précision sur les grands montants', () => {
    expect(toMinor('999999999999999', 'XAF')).toBe(999999999999999n);
    expect(toMinor('123456789012345.67', 'EUR')).toBe(12345678901234567n);
  });

  it('applique un pourcentage en points de base avec arrondi inférieur', () => {
    expect(applyPercentBps(50000n, 500)).toBe(2500n);
    expect(applyPercentBps(333n, 500)).toBe(16n);
    expect(percentToBps(2.5)).toBe(250);
    expect(() => percentToBps(101)).toThrow();
  });

  it('formate pour l’affichage', () => {
    expect(formatMoney(1500000n, 'XAF')).toBe('1 500 000 XAF');
    expect(formatMoney(123456n, 'CAD', 'en-CA')).toBe('1,234.56 CAD');
  });

  it('valide un montant saisi via zod', () => {
    expect(moneyInputSchema.parse({ amount: '100', currency: 'xaf' })).toEqual({ currency: 'XAF', minor: 100n });
    expect(moneyInputSchema.safeParse({ amount: '0', currency: 'XAF' }).success).toBe(false);
    expect(moneyInputSchema.safeParse({ amount: '1.5', currency: 'XAF' }).success).toBe(false);
  });
});
