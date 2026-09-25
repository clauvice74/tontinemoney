import { describe, expect, it } from 'vitest';
import { createTontineSchema, registerMemberSchema, createTontineAdminSchema } from './index';

describe('Schémas de validation', () => {
  it('US-1.2 : au moins un identifiant requis', () => {
    const r = registerMemberSchema.safeParse({ firstName: 'Jean', lastName: 'Dupont', preferredChannel: 'EMAIL' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Au moins un identifiant requis');
  });

  it('US-1.1 : téléphone non E.164 rejeté', () => {
    const r = createTontineAdminSchema.safeParse({
      firstName: 'Awa',
      lastName: 'Ngono',
      email: 'awa@example.test',
      phone: '699123445',
      country: 'CM',
      language: 'fr-CM',
      tontineName: 'Solidarité',
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Format téléphone invalide');
  });

  it('US-4.1 : fréquence mensuelle exige jour + semaine', () => {
    const base = {
      name: 'Tontine test',
      contributionAmount: '50000',
      frequency: 'MONTHLY',
      maxMembers: 12,
      startDate: '2030-01-01',
      drawMode: 'RANDOM',
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 2 },
    };
    expect(createTontineSchema.safeParse(base).success).toBe(false);
    expect(
      createTontineSchema.safeParse({ ...base, frequencyDetail: { day: 'wednesday', weekOfMonth: 1 } }).success,
    ).toBe(true);
  });

  it('US-4.1 : nombre de membres borné à 3-50', () => {
    const r = createTontineSchema.safeParse({
      name: 'Tontine test',
      contributionAmount: '50000',
      frequency: 'WEEKLY',
      frequencyDetail: { day: 'friday' },
      maxMembers: 51,
      startDate: '2030-01-01',
      drawMode: 'RANDOM',
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 2 },
    });
    expect(r.success).toBe(false);
  });
});
