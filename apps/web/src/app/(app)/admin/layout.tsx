'use client';

import { Alert } from '@tontine/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RequireRole } from '@/components/guards';
import { useI18n } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/queries';

/** Espace super-administrateur : rôle SUPER_ADMIN et session ouverte avec MFA (API). */
export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const user = useCurrentUser();
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      {user && !user.mfa.usedThisSession ? (
        <Alert variant="warning" title={t('platform.mfaWarningTitle')} className="mb-6">
          {t('platform.mfaWarningBody')}{' '}
          <Link href="/security" className="font-medium underline">
            {t('platform.mfaLink')}
          </Link>
        </Alert>
      ) : null}
      {children}
    </RequireRole>
  );
}
