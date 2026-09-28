import * as React from 'react';
import { cn } from '../lib/cn';

export interface KpiCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  label: React.ReactNode;
  /** Valeur principale (montant, nombre) : graisse 500. */
  value: React.ReactNode;
  /** Unité ou devise, en texte secondaire (charte §09 : montant puis devise). */
  unit?: React.ReactNode;
  /** Variation ou précision, ex. « +12 % ce mois ». */
  hint?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
  icon?: React.ReactNode;
}

const TONE: Record<NonNullable<KpiCardProps['tone']>, string> = {
  default: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  info: 'text-info',
};

/** Carte d'indicateur (tableaux de bord) : libellé, valeur, unité, précision. */
export function KpiCard({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  icon,
  className,
  ...props
}: KpiCardProps) {
  return (
    <div
      className={cn('rounded-lg border bg-card p-4 text-card-foreground shadow-sm', className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-h2 font-medium tabular-nums leading-none">{value}</span>
        {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      </p>
      {hint ? <p className={cn('mt-1.5 text-xs', TONE[tone])}>{hint}</p> : null}
    </div>
  );
}
