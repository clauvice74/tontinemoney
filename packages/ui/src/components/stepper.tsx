import { Check } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export interface StepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: string[];
  /** Index de l'étape courante (0 = première). */
  current: number;
  /** Libellé accessible, ex. « Étapes de l’inscription ». */
  label: string;
}

/** Indicateur d'étapes d'un parcours guidé (inscription, assistant de création). */
export function Stepper({ steps, current, label, className, ...props }: StepperProps) {
  return (
    <ol aria-label={label} className={cn('flex items-start gap-2', className)} {...props}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={s}
            aria-current={active ? 'step' : undefined}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn('h-1 rounded-sm', done || active ? 'bg-progress' : 'bg-muted')}
            />
            <span
              className={cn(
                'flex items-center gap-1 truncate text-xs',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3 shrink-0 text-success" aria-hidden="true" /> : null}
              <span className="truncate">{s}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
