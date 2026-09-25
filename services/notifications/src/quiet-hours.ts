/** Heures calmes (US-8.2, US-8.4) : calcul dans le fuseau du destinataire (R-NOT-03). */
export interface QuietHours {
  start: string; // HH:MM
  end: string; // HH:MM
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Heure locale (minutes depuis minuit) dans un fuseau IANA. */
export function localMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function isQuietTime(
  at: Date,
  timezone: string,
  quiet: QuietHours | null | undefined,
): boolean {
  if (!quiet) return false;
  const now = localMinutes(at, timezone);
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Premier instant (arrondi à la minute) hors heures calmes. */
export function nextAllowedTime(
  at: Date,
  timezone: string,
  quiet: QuietHours | null | undefined,
): Date {
  if (!isQuietTime(at, timezone, quiet) || !quiet) return at;
  const now = localMinutes(at, timezone);
  const end = minutesOf(quiet.end);
  const delta = (end - now + 1440) % 1440;
  const next = new Date(at.getTime() + delta * 60_000);
  next.setUTCSeconds(0, 0);
  return next;
}
