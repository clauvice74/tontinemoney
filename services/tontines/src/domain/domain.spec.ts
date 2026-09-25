import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addDays, cycleStartDate, dueDateForCycle, frequencyLabel, localDate } from './calendar';
import { draw, shuffle, verifyDraw } from './draw';

describe('calendrier des échéances (A-27)', () => {
  it('WEEKLY : premier mercredi ≥ début puis +7 j', () => {
    // 2026-11-04 est un mercredi
    expect(dueDateForCycle('WEEKLY', { day: 'wednesday' }, '2026-11-02', 1)).toBe('2026-11-04');
    expect(dueDateForCycle('WEEKLY', { day: 'wednesday' }, '2026-11-02', 3)).toBe('2026-11-18');
    expect(dueDateForCycle('WEEKLY', { day: 'wednesday' }, '2026-11-04', 1)).toBe('2026-11-11');
  });
  it('BIWEEKLY : +14 j', () => {
    expect(dueDateForCycle('BIWEEKLY', { day: 'friday' }, '2026-11-02', 2)).toBe('2026-11-20');
  });
  it('MONTHLY : 1er mercredi du mois', () => {
    expect(dueDateForCycle('MONTHLY', { day: 'wednesday', weekOfMonth: 1 }, '2026-11-02', 1)).toBe(
      '2026-11-04',
    );
    expect(dueDateForCycle('MONTHLY', { day: 'wednesday', weekOfMonth: 1 }, '2026-11-05', 1)).toBe(
      '2026-12-02',
    );
    expect(dueDateForCycle('MONTHLY', { day: 'wednesday', weekOfMonth: 1 }, '2026-11-02', 3)).toBe(
      '2027-01-06',
    );
  });
  it('MONTHLY : dernier vendredi et dernier jour du mois (février bissextile)', () => {
    expect(dueDateForCycle('MONTHLY', { day: 'friday', weekOfMonth: -1 }, '2026-11-01', 1)).toBe(
      '2026-11-27',
    );
    expect(dueDateForCycle('MONTHLY', { lastDayOfMonth: true }, '2028-01-30', 2)).toBe(
      '2028-02-29',
    );
  });
  it('BIMONTHLY : le 15 et le dernier jour (le « 30 » de février devient le 28)', () => {
    const dates = [1, 2, 3, 4].map((n) => dueDateForCycle('BIMONTHLY', {}, '2027-01-20', n));
    expect(dates).toEqual(['2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15']);
  });
  it('début de cycle = lendemain de l’échéance précédente', () => {
    expect(cycleStartDate('WEEKLY', { day: 'monday' }, '2026-11-02', 1)).toBe('2026-11-02');
    expect(cycleStartDate('WEEKLY', { day: 'monday' }, '2026-11-02', 2)).toBe('2026-11-10');
  });
  it('date civile locale selon le fuseau', () => {
    const now = new Date('2026-09-24T23:30:00Z');
    expect(localDate('Africa/Douala', now)).toBe('2026-09-25');
    expect(localDate('America/Toronto', now)).toBe('2026-09-24');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('libellés', () => {
    expect(frequencyLabel('MONTHLY', { day: 'wednesday', weekOfMonth: 1 })).toBe(
      'chaque mois (1er mercredi)',
    );
    expect(frequencyLabel('BIMONTHLY', {}, 'en')).toContain('15th');
  });
});

describe('tirage Fisher-Yates (US-4.3 §4)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('permutation complète, déterministe pour une graine donnée', () => {
    const seed = randomBytes(32);
    const r1 = shuffle(ids, seed);
    expect([...r1].sort()).toEqual(ids);
    expect(shuffle(ids, seed)).toEqual(r1);
  });
  it('preuve vérifiable, falsification détectée', () => {
    const r = draw('t1', ids, new Date('2026-11-04T00:00:00Z'));
    expect(r.proof).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyDraw('t1', [...ids].reverse(), r)).toBe(true);
    expect(verifyDraw('t1', ids, { ...r, order: [...r.order].reverse() })).toBe(false);
    expect(verifyDraw('t2', ids, r)).toBe(false);
  });
  it('distribution approximativement uniforme de la première position', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const first = shuffle(ids, randomBytes(32))[0]!;
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    for (const id of ids) expect(counts.get(id)!).toBeGreaterThan(850);
  });
});
