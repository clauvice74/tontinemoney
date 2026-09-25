'use client';

import { Alert } from '@tontine/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RequireRole } from '@/components/guards';
import { useCurrentUser } from '@/lib/queries';

/** Espace super-administrateur : rôle SUPER_ADMIN et session ouverte avec MFA (API). */
export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      {user && !user.mfa.usedThisSession ? (
        <Alert variant="warning" title="Session sans double authentification" className="mb-6">
          Les opérations d’administration exigent une session ouverte avec MFA. Si ce n’est pas
          encore fait,{' '}
          <Link href="/security" className="font-medium underline">
            activez la double authentification
          </Link>{' '}
          puis reconnectez-vous.
        </Alert>
      ) : null}
      {children}
    </RequireRole>
  );
}
