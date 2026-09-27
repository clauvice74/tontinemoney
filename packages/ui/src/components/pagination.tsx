import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';

export interface CursorPaginationProps {
  /** Numéro (1-based) de la page affichée. */
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  loading?: boolean;
  className?: string;
  /** Libellé complémentaire (ex. « 20 par page »). */
  info?: string;
}

/**
 * Pagination par curseur (API opaque `nextCursor`) : navigation précédente / suivante.
 * La pile des curseurs précédents est gérée par l'appelant (voir `useCursorPagination`).
 */
export function CursorPagination({
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  loading,
  className,
  info,
}: CursorPaginationProps) {
  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-between gap-3 pt-3', className)}
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Page {page}
        {info ? ` · ${info}` : ''}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={!hasPrevious || loading}
          aria-label="Page précédente"
        >
          <ChevronLeft aria-hidden="true" />
          <span className="hidden sm:inline">Précédent</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!hasNext || loading}
          aria-label="Page suivante"
        >
          <span className="hidden sm:inline">Suivant</span>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
