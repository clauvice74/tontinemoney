/** Décalage (minutes) d'un fuseau IANA à un instant donné. */
export function tzOffsetMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Instant UTC correspondant à une date civile + heure locale dans un fuseau. */
export function localToUtc(date: string, time: string, timezone: string): Date {
  const [h = '0', m = '0'] = time.split(':');
  const naive = new Date(`${date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00Z`);
  const offset = tzOffsetMinutes(naive, timezone);
  return new Date(naive.getTime() - offset * 60_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(date: string | Date, language: string): string {
  const iso = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const [y, mo, d] = iso.split('-');
  return language.startsWith('en') ? `${mo}/${d}/${y}` : `${d}/${mo}/${y}`;
}
