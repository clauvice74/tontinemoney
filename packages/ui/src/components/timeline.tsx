import { Check, Circle, Clock, X } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export type TimelineStatus = 'done' | 'current' | 'upcoming' | 'failed';

export interface TimelineItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  status: TimelineStatus;
}

const MARKERS: Record<TimelineStatus, { icon: typeof Check; className: string; label: string }> = {
  done: { icon: Check, className: 'bg-success-soft text-success', label: 'Terminé' },
  current: {
    icon: Clock,
    className: 'bg-gold-pale text-warning ring-2 ring-gold',
    label: 'En cours',
  },
  upcoming: { icon: Circle, className: 'bg-muted text-muted-foreground', label: 'À venir' },
  failed: { icon: X, className: 'bg-destructive-soft text-destructive', label: 'En échec' },
};

export interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  items: TimelineItem[];
  /** Libellés des états (traductions) ; français par défaut. */
  statusLabels?: Partial<Record<TimelineStatus, string>>;
}

/** Chronologie (cycles d'une tontine, étapes d'un paiement) : liste ordonnée accessible. */
export function Timeline({ items, statusLabels, className, ...props }: TimelineProps) {
  return (
    <ol className={cn('relative space-y-4', className)} {...props}>
      {items.map((item, i) => {
        const m = MARKERS[item.status];
        const Icon = m.icon;
        return (
          <li
            key={item.id}
            className="relative flex gap-3"
            aria-current={item.status === 'current' ? 'step' : undefined}
          >
            {i < items.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute left-3.5 top-8 h-[calc(100%-1rem)] w-px bg-border"
              />
            ) : null}
            <span
              className={cn(
                'relative grid size-7 shrink-0 place-items-center rounded-full',
                m.className,
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{statusLabels?.[item.status] ?? m.label}</span>
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">{item.title}</p>
                {item.meta ? <p className="text-xs text-muted-foreground">{item.meta}</p> : null}
              </div>
              {item.description ? (
                <div className="mt-0.5 text-xs text-muted-foreground">{item.description}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
