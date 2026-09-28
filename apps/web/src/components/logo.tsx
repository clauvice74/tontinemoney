'use client';

import Link from 'next/link';
import { cn } from '@tontine/ui';
import { useI18n } from '@/lib/i18n';

/**
 * Icône « coupe » de la charte (§01) : le pot commun, une pièce qui y tombe.
 * Or sur navy (variante principale) ou navy sur fond clair.
 */
export function LogoMark({ className, onNavy = false }: { className?: string; onNavy?: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn('size-8 shrink-0', className)}
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill={onNavy ? '#FAEEDA' : '#042C53'} />
      <circle cx="16" cy="8.5" r="3" fill="#EF9F27" />
      <path d="M7 14h18a9 9 0 0 1-18 0Z" fill={onNavy ? '#042C53' : '#BA7517'} />
      <rect x="12" y="23.5" width="8" height="2" rx="1" fill={onNavy ? '#042C53' : '#BA7517'} />
    </svg>
  );
}

/** Logo : icône + nom de marque (+ accroche optionnelle). */
export function Logo({
  href = '/',
  onNavy = false,
  tagline = false,
  className,
}: {
  href?: string;
  onNavy?: boolean;
  tagline?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2',
        onNavy ? 'focus-visible:ring-nav-ring' : 'focus-visible:ring-ring',
        className,
      )}
    >
      <LogoMark onNavy={onNavy} />
      <span className="leading-tight">
        <span
          className={cn(
            'block text-base font-medium',
            onNavy ? 'text-gold-pale' : 'text-foreground',
          )}
        >
          TontineMoney
        </span>
        {tagline ? (
          <span
            className={cn(
              'block text-xs',
              onNavy ? 'text-nav-foreground' : 'text-muted-foreground',
            )}
          >
            CIGALE · {t('common.tagline')}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
