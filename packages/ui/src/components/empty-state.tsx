import * as React from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** État vide (aucune donnée, fonctionnalité à venir…). */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 rounded-full bg-secondary p-3 text-secondary-foreground [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-medium">{title}</p>
      {description ? (
        <div className="max-w-md text-sm text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
