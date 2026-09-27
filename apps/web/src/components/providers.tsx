'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@tontine/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { bootstrapSession } from '@/lib/auth/session';
import { useAuthStore } from '@/lib/auth/store';
import { makeQueryClient } from '@/lib/query-client';
import { installFrenchZodErrors } from '@/lib/zod-fr';

installFrenchZodErrors();

export function Providers({ children }: { children: ReactNode }) {
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
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
