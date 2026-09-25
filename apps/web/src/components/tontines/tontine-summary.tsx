import type { TontineView } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import {
  DRAW_MODE_LABELS,
  FREQUENCY_LABELS,
  INCOMPLETE_POLICY_LABELS,
  WEEKDAY_LABELS,
  WEEK_OF_MONTH_LABELS,
  label,
} from '@/lib/labels';
import { Money } from '../money';

export function frequencyText(t: Pick<TontineView, 'frequency' | 'frequencyDetail'>): string {
  const base = label(FREQUENCY_LABELS, t.frequency);
  const d = t.frequencyDetail ?? {};
  const day = typeof d.day === 'string' ? WEEKDAY_LABELS[d.day]?.toLowerCase() : undefined;
  if (t.frequency === 'MONTHLY') {
    if (d.lastDayOfMonth) return `${base} — dernier jour du mois`;
    if (day && d.weekOfMonth !== undefined) {
      return `${base} — ${day}, ${label(WEEK_OF_MONTH_LABELS, String(d.weekOfMonth)).toLowerCase()}`;
    }
  }
  if (day) return `${base} — le ${day}`;
  return base;
}

/** Fiche de configuration d'une tontine. */
export function TontineSummary({ tontine: t }: { tontine: TontineView }) {
  const p = t.penaltyRules ?? {};
  const rows: Array<[string, React.ReactNode]> = [
    ['Cotisation', <Money key="c" value={t.contribution} />],
    ['Fréquence', frequencyText(t)],
    ['Début', formatDate(t.startDate)],
    ['Membres', `${t.memberCount} / ${t.maxMembers}`],
    ['Mode de tirage', label(DRAW_MODE_LABELS, t.drawMode)],
    [
      'Cycle en cours',
      t.currentCycleNumber ? `${t.currentCycleNumber} / ${t.totalCycles ?? '?'}` : 'Non démarrée',
    ],
    ['Droit d’entrée', t.entryFee ? <Money key="e" value={t.entryFee} /> : 'Aucun'],
    ['Collation par tour', t.collation ? <Money key="k" value={t.collation} /> : 'Aucune'],
    [
      'Pénalités',
      `${p.graceDays ?? 0} j de grâce · ${p.lateFeePercent ?? 0} % · suspension après ${p.suspendAfter ?? '—'} défaut(s)`,
    ],
    ['Cotisations incomplètes', label(INCOMPLETE_POLICY_LABELS, t.incompletePolicy)],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
