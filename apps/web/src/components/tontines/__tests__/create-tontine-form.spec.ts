import { describe, expect, it } from 'vitest';
import { buildCreateTontineFormSchema, parseInvitees } from '../create-tontine-form';

describe('assistant de création : invitations', () => {
  it('accepte un e-mail ou un numéro international par ligne, ignore les lignes vides', () => {
    expect(parseInvitees('awa@example.org\n\n +237 6 00 00 00 00 \n')).toEqual({
      targets: [
        { channel: 'EMAIL', email: 'awa@example.org' },
        { channel: 'PHONE', phone: '+237600000000' },
      ],
    });
  });

  it('signale la première ligne invalide', () => {
    expect(parseInvitees('awa@example.org\n0600\nbob@example.org').invalidLine).toBe(2);
  });
});

describe('assistant de création : schéma', () => {
  const today = new Date('2026-09-27T10:00:00');
  const base = {
    name: 'Tontine test',
    contributionAmount: '10000',
    currency: 'XAF',
    frequency: 'MONTHLY',
    frequencyDetail: { lastDayOfMonth: true },
    maxMembers: 5,
    drawMode: 'RANDOM',
    penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 3, defaultAfterDays: 7 },
    incompletePolicy: 'POSTPONE',
  };

  it('refuse un démarrage avant J+7 avec le message traduit', () => {
    const schema = buildCreateTontineFormSchema(today, (d) => `too early ${d}`);
    const r = schema.safeParse({ ...base, startDate: '2026-09-30' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === 'startDate')?.message).toBe(
      'too early 04/10/2026',
    );
  });

  it('accepte un démarrage à J+7', () => {
    const schema = buildCreateTontineFormSchema(today);
    expect(schema.safeParse({ ...base, startDate: '2026-10-04' }).success).toBe(true);
  });
});
