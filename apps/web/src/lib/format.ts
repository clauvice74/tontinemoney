const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function toDate(value: string | Date): Date | null {
  const d =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 24 sept. 2026 » */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = toDate(value);
  return d ? dateFormatter.format(d) : '—';
}

/** « 24 sept. 2026, 14:05 » */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = toDate(value);
  return d ? dateTimeFormatter.format(d) : '—';
}

/** Durée relative courte : « il y a 3 h », « dans 2 j ». */
export function formatRelative(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const d = toDate(value);
  if (!d) return '—';
  const diffMs = d.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const amount = minutes < 60 ? `${minutes} min` : hours < 48 ? `${hours} h` : `${days} j`;
  if (minutes < 1) return 'à l’instant';
  return diffMs < 0 ? `il y a ${amount}` : `dans ${amount}`;
}

/** Date civile locale AAAA-MM-JJ décalée de `days` jours. */
export function isoDateFromToday(days: number, today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

export function fullName(p: { firstName?: string | null; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || '—';
}
