'use client';

import type { PlatformRole } from '@tontine/contracts';
import { EmptyState, LoadingBlock } from '@tontine/ui';
import { ShieldAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useAuthStore } from '@/lib/auth/store';

/** Protège l'espace connecté : attend la restauration de session puis redirige si anonyme. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  if (status !== 'authenticated') {
    return (
      <div className="mx-auto max-w-md p-10">
        <LoadingBlock label="Vérification de la session…" />
      </div>
    );
  }
  return <>{children}</>;
}

/** Restreint une page à certains rôles de plateforme. */
export function RequireRole({ roles, children }: { roles: PlatformRole[]; children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  if (!roles.includes(user.role)) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden="true" />}
        title="Accès refusé"
        description="Cette section est réservée à d’autres profils d’utilisateurs."
      />
    );
  }
  return <>{children}</>;
}
