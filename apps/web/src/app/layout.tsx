import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { LOCALE_COOKIE, THEME_COOKIE, asLocale, asTheme } from '@/lib/i18n/config';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'TontineMoney', template: '%s · TontineMoney' },
  description:
    'Épargnez ensemble, en toute confiance : tontines, portefeuille, cotisations et vérification d’identité.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#042c53' },
    { media: '(prefers-color-scheme: dark)', color: '#021b33' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Préférences lues côté serveur : langue et thème corrects dès le premier rendu
  const store = await cookies();
  const locale = asLocale(store.get(LOCALE_COOKIE)?.value);
  const theme = asTheme(store.get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} data-theme={theme === 'system' ? undefined : theme}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers locale={locale} theme={theme}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
