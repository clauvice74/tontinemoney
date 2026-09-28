'use client';

import { cn } from '@tontine/ui';
import { LOCALES, useI18n } from '@/lib/i18n';

/** Choix de la langue (FR / EN) pour les pages publiques. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t('prefs.language')}
      className={cn('flex rounded-md border p-0.5', className)}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
          className={cn(
            'rounded-sm px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            locale === l
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span aria-hidden="true">{l.toUpperCase()}</span>
          <span className="sr-only">{l === 'fr' ? 'Français' : 'English'}</span>
        </button>
      ))}
    </div>
  );
}
