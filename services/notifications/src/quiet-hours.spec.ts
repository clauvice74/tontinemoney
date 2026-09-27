import { describe, expect, it } from 'vitest';
import { isQuietTime, nextAllowedTime } from './quiet-hours';
import { renderTemplate, stripAccents } from './render';

describe('Heures calmes (US-8.2 / R-NOT-03)', () => {
  const quiet = { start: '22:00', end: '07:00' };
  it('respecte le fuseau du membre', () => {
    // 23:30 à Douala (UTC+1) = 22:30 UTC
    expect(isQuietTime(new Date('2026-05-01T22:30:00Z'), 'Africa/Douala', quiet)).toBe(true);
    // même instant à Toronto (UTC-4) = 18:30 → pas en heures calmes
    expect(isQuietTime(new Date('2026-05-01T22:30:00Z'), 'America/Toronto', quiet)).toBe(false);
  });

  it('reporte à la fin des heures calmes', () => {
    const at = new Date('2026-05-01T22:30:00Z'); // 23:30 Douala
    expect(nextAllowedTime(at, 'Africa/Douala', quiet).toISOString()).toBe(
      '2026-05-02T06:00:00.000Z',
    );
    expect(
      nextAllowedTime(new Date('2026-05-01T12:00:00Z'), 'Africa/Douala', quiet).toISOString(),
    ).toBe('2026-05-01T12:00:00.000Z');
  });

  it('gère une plage dans la même journée et l’absence de plage', () => {
    expect(
      isQuietTime(new Date('2026-05-01T13:30:00Z'), 'UTC', { start: '13:00', end: '14:00' }),
    ).toBe(true);
    expect(isQuietTime(new Date('2026-05-01T13:30:00Z'), 'UTC', null)).toBe(false);
  });
});

describe('Rendu des modèles (US-8.2)', () => {
  it('injecte les variables selon la langue', () => {
    const fr = renderTemplate('tontine.cycle_completed', 'IN_APP', 'fr-CM', {
      numero: 3,
      tontine: 'Solidarité',
      prenom: 'Awa',
    });
    expect(fr.body).toBe('Le cycle 3 de Solidarité est terminé, Awa a reçu le pot.');
    const en = renderTemplate('tontine.cycle_completed', 'IN_APP', 'en-CM', {
      numero: 3,
      tontine: 'Solidarité',
      prenom: 'Awa',
    });
    expect(en.body).toContain('Round 3');
  });

  it('SMS : court, sans montant exact, sans accents pour les pays concernés (R-NOT-02, R-COM-01)', () => {
    const sms = renderTemplate(
      'tontine.payout_received',
      'SMS',
      'fr-CM',
      { montant: '600 000 XAF', tontine: 'Épargne' },
      { country: 'CM' },
    );
    expect(sms.body).not.toContain('600');
    expect(sms.body).toBe(stripAccents(sms.body));
    expect(sms.body.length).toBeLessThanOrEqual(160);
  });

  it('masque les variables sensibles dans la version stockée', () => {
    const stored = renderTemplate(
      'auth.activation_otp',
      'SMS',
      'fr',
      { code: '123456' },
      { maskSensitive: true },
    );
    expect(stored.body).not.toContain('123456');
  });
});
