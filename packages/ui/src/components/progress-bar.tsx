import * as React from 'react';
import { cn } from '../lib/cn';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Valeur courante (bornée entre 0 et `max`). */
  value: number;
  max?: number;
  /** Libellé accessible (obligatoire si aucun libellé visible n'est associé). */
  label: string;
  /** Texte de valeur lu par les lecteurs d'écran, ex. « Cycle 7 sur 12 ». */
  valueText?: string;
  /** Affiche le libellé et le pourcentage au-dessus de la barre. */
  showLabel?: boolean;
}

/**
 * Barre de progression (charte §09) : or #BA7517 uniquement, sur la surface #F1EFE8 (≥ 3:1).
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  showLabel = false,
  className,
  ...props
}: ProgressBarProps) {
  const bounded = Math.min(Math.max(value, 0), max);
  const pct = max > 0 ? Math.round((bounded / max) * 100) : 0;
  return (
    <div className={cn('space-y-1.5', className)} {...props}>
      {showLabel ? (
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="font-medium tabular-nums text-foreground">
            {valueText ?? `${pct} %`}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={bounded}
        aria-valuetext={valueText ?? `${pct} %`}
        className="h-2 w-full overflow-hidden rounded-sm bg-muted"
      >
        <div
          className="h-full rounded-sm bg-progress transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
