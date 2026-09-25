import { cn } from '@tontine/ui';
import type { MoneyView } from '@/lib/api/types';
import { formatMoneyView } from '@/lib/money';

/** Montant formaté (séparateurs, devise, sans décimales pour XAF/XOF). */
export function Money({
  value,
  signed,
  className,
}: {
  value: MoneyView | null | undefined;
  /** Affiche + / − selon le sens. */
  signed?: 'in' | 'out';
  className?: string;
}) {
  const text = formatMoneyView(value);
  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        signed === 'in' && 'text-success',
        signed === 'out' && 'text-foreground',
        className,
      )}
    >
      {signed === 'in' ? '+ ' : signed === 'out' ? '− ' : ''}
      {text}
    </span>
  );
}
