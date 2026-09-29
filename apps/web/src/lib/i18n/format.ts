'use client';

import { useMemo } from 'react';
import { useI18n } from './index';

function toDate(value: string | Date): Date | null {
  const d =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Formats de dates dans la langue courante (« 24 sept. 2026 » / « 24 Sept 2026 »). */
export function useFormat() {
  const { intlLocale, locale } = useI18n();
  return useMemo(() => {
    const date = new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const dateTime = new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const relative = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto', style: 'short' });
    return {
      date(v: string | Date | null | undefined): string {
        const d = v ? toDate(v) : null;
        return d ? date.format(d) : '—';
      },
      dateTime(v: string | Date | null | undefined): string {
        const d = v ? toDate(v) : null;
        return d ? dateTime.format(d) : '—';
      },
      relative(v: string | Date | null | undefined, now = new Date()): string {
        const d = v ? toDate(v) : null;
        if (!d) return '—';
        const diff = d.getTime() - now.getTime();
        const minutes = Math.round(diff / 60_000);
        if (Math.abs(minutes) < 1) return locale === 'en' ? 'just now' : 'à l’instant';
        if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
        const hours = Math.round(diff / 3_600_000);
        if (Math.abs(hours) < 48) return relative.format(hours, 'hour');
        return relative.format(Math.round(diff / 86_400_000), 'day');
      },
    };
  }, [intlLocale, locale]);
}
