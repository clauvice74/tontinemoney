/**
 * Calendrier des échéances (US-4.1 §2, US-4.4 §3, A-27). Fonctions pures sur des dates civiles
 * `AAAA-MM-JJ` : aucune dépendance au fuseau du serveur.
 */

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY';
export type Weekday =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface FrequencyDetail {
  day?: Weekday;
  weekOfMonth?: 1 | 2 | 3 | 4 | -1;
  lastDayOfMonth?: boolean;
}

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function parse(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date civile invalide : ${date}`);
  return new Date(`${date}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** Date civile courante dans un fuseau IANA. */
export function localDate(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA → AAAA-MM-JJ
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** n-ième jour de semaine d'un mois (weekOfMonth = -1 → dernier). */
function nthWeekday(year: number, month0: number, weekday: number, n: number): string {
  if (n === -1) {
    const last = lastDayOfMonth(year, month0);
    const d = new Date(Date.UTC(year, month0, last));
    const back = (d.getUTCDay() - weekday + 7) % 7;
    d.setUTCDate(last - back);
    return fmt(d);
  }
  const first = new Date(Date.UTC(year, month0, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return fmt(new Date(Date.UTC(year, month0, 1 + offset + (n - 1) * 7)));
}

function monthlyOccurrence(year: number, month0: number, detail: FrequencyDetail): string {
  if (detail.lastDayOfMonth || !detail.day || detail.weekOfMonth === undefined) {
    return fmt(new Date(Date.UTC(year, month0, lastDayOfMonth(year, month0))));
  }
  return nthWeekday(year, month0, WEEKDAY_INDEX[detail.day], detail.weekOfMonth);
}

/** Première occurrence ≥ `from` (incluse) de la règle de fréquence. */
function firstOccurrence(frequency: Frequency, detail: FrequencyDetail, from: string): string {
  const start = parse(from);
  switch (frequency) {
    case 'WEEKLY':
    case 'BIWEEKLY': {
      const target = WEEKDAY_INDEX[detail.day ?? 'monday'];
      const offset = (target - start.getUTCDay() + 7) % 7;
      return addDays(from, offset);
    }
    case 'MONTHLY': {
      let y = start.getUTCFullYear();
      let m = start.getUTCMonth();
      for (;;) {
        const occ = monthlyOccurrence(y, m, detail);
        if (occ >= from) return occ;
        m += 1;
        if (m === 12) {
          m = 0;
          y += 1;
        }
      }
    }
    case 'BIMONTHLY': {
      // A-27 : le 15 et le dernier jour du mois
      let y = start.getUTCFullYear();
      let m = start.getUTCMonth();
      for (;;) {
        const mid = fmt(new Date(Date.UTC(y, m, 15)));
        if (mid >= from) return mid;
        const end = fmt(new Date(Date.UTC(y, m, lastDayOfMonth(y, m))));
        if (end >= from) return end;
        m += 1;
        if (m === 12) {
          m = 0;
          y += 1;
        }
      }
    }
  }
}

/**
 * Date limite du cycle `n` (1-indexé). Le cycle 1 échoit à la première occurrence de la règle
 * postérieure à la date de début ; chaque cycle suivant à l'occurrence suivante.
 */
export function dueDateForCycle(
  frequency: Frequency,
  detail: FrequencyDetail,
  startDate: string,
  n: number,
): string {
  if (n < 1) throw new Error('Numéro de cycle invalide');
  // A-27 : la 1re échéance est la première occurrence STRICTEMENT après la date de début
  // (les membres disposent toujours d'au moins un jour pour cotiser).
  let due = firstOccurrence(frequency, detail, addDays(startDate, 1));
  for (let i = 1; i < n; i++) {
    switch (frequency) {
      case 'WEEKLY':
        due = addDays(due, 7);
        break;
      case 'BIWEEKLY':
        due = addDays(due, 14);
        break;
      case 'MONTHLY':
      case 'BIMONTHLY':
        due = firstOccurrence(frequency, detail, addDays(due, 1));
        break;
    }
  }
  return due;
}

/** Début du cycle `n` : date de début de la tontine, puis lendemain de l'échéance précédente. */
export function cycleStartDate(
  frequency: Frequency,
  detail: FrequencyDetail,
  startDate: string,
  n: number,
): string {
  return n === 1 ? startDate : addDays(dueDateForCycle(frequency, detail, startDate, n - 1), 1);
}

/** Libellé lisible de la fréquence (notifications, rapports). */
export function frequencyLabel(
  frequency: Frequency,
  detail: FrequencyDetail,
  language = 'fr',
): string {
  const fr = language.startsWith('fr');
  const dayFr: Record<Weekday, string> = {
    monday: 'lundi',
    tuesday: 'mardi',
    wednesday: 'mercredi',
    thursday: 'jeudi',
    friday: 'vendredi',
    saturday: 'samedi',
    sunday: 'dimanche',
  };
  const day = detail.day ? (fr ? dayFr[detail.day] : detail.day) : '';
  switch (frequency) {
    case 'WEEKLY':
      return fr ? `chaque semaine (${day})` : `weekly (${day})`;
    case 'BIWEEKLY':
      return fr ? `toutes les deux semaines (${day})` : `every two weeks (${day})`;
    case 'BIMONTHLY':
      return fr ? 'le 15 et le dernier jour du mois' : 'on the 15th and last day of the month';
    case 'MONTHLY': {
      if (detail.lastDayOfMonth || detail.weekOfMonth === undefined)
        return fr ? 'le dernier jour du mois' : 'on the last day of the month';
      const rank =
        detail.weekOfMonth === -1
          ? fr
            ? 'dernier'
            : 'last'
          : fr
            ? detail.weekOfMonth === 1
              ? '1er'
              : `${detail.weekOfMonth}e`
            : `#${detail.weekOfMonth}`;
      return fr ? `chaque mois (${rank} ${day})` : `monthly (${rank} ${day})`;
    }
  }
}
