'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@tontine/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { bootstrapSession } from '@/lib/auth/session';
import { I18nProvider, type Locale, type ThemePreference } from '@/lib/i18n';
import { useAuthStore } from '@/lib/auth/store';
import { makeQueryClient } from '@/lib/query-client';
import { installFrenchZodErrors } from '@/lib/zod-fr';

installFrenchZodErrors();

export function Providers({
  children,
  locale,
  theme,
}: {
  children: ReactNode;
  locale: Locale;
  theme: ThemePreference;
}) {
  const [queryClient] = useState(makeQueryClient);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void bootstrapSession();
  }, []);

  // Déconnexion (volontaire ou session expirée) : purge du cache des données serveur.
  useEffect(() => {
    if (status === 'anonymous') queryClient.clear();
  }, [status, queryClient]);

  return (
    <I18nProvider initialLocale={locale} initialTheme={theme}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </I18nProvider>
  );
}
