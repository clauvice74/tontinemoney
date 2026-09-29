'use client';

import { formatMoney, toMinor } from '@tontine/contracts';
import { cn } from '@tontine/ui';
import type { MoneyView } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';

/** Valeur numérique formatée selon la langue, sans la devise. */
function numberPart(money: MoneyView, intlLocale: string): string {
  try {
    const minor =
      money.amountMinor !== undefined && money.amountMinor !== null && money.amountMinor !== ''
        ? BigInt(money.amountMinor)
        : toMinor(money.amount, money.currency);
    const text = formatMoney(minor, money.currency, intlLocale);
    return text.slice(0, text.length - money.currency.length - 1);
  } catch {
    return money.amount;
  }
}

/**
 * Montant selon la charte (§09) : valeur en graisse 500 à chiffres tabulaires, puis la devise
 * en texte secondaire. `size` : taille de la valeur ; `signed` : entrée (+, succès) / sortie (−).
 */
export function Amount({
  value,
  size = 'body',
  signed,
  onNavy = false,
  className,
}: {
  value: MoneyView | null | undefined;
  size?: 'body' | 'h3' | 'h2' | 'h1';
  signed?: 'in' | 'out';
  /** Sur fond navy : valeur or pâle, devise en texte de navigation (contrastes AA). */
  onNavy?: boolean;
  className?: string;
}) {
  const { intlLocale } = useI18n();
  if (!value) return <span className="text-muted-foreground">—</span>;
  const sizes = { body: 'text-sm', h3: 'text-h3', h2: 'text-h2', h1: 'text-h1' } as const;
  return (
    <span className={cn('inline-flex items-baseline gap-1 whitespace-nowrap', className)}>
      <span
        className={cn('font-medium tabular-nums', sizes[size], signed === 'in' && 'text-success')}
      >
        {signed === 'in' ? '+ ' : signed === 'out' ? '− ' : ''}
        {numberPart(value, intlLocale)}
      </span>
      <span
        className={cn(
          'text-xs font-normal',
          onNavy ? 'text-nav-foreground' : 'text-muted-foreground',
        )}
      >
        {value.currency}
      </span>
    </span>
  );
}
