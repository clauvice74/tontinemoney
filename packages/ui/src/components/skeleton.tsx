import * as React from 'react';
import { cn } from '../lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** Bloc de chargement annoncé aux technologies d'assistance. */
export function LoadingBlock({
  label = 'Chargement…',
  lines = 3,
  className,
}: {
  label?: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i === 0 ? 'w-2/3' : i % 2 ? 'w-full' : 'w-5/6')} />
      ))}
    </div>
  );
}
