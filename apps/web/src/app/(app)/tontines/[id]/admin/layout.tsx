'use client';

import { EmptyState, LoadingBlock, cn } from '@tontine/ui';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorAlert, isComingSoon } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { TONTINE_STATUS_LABELS } from '@/lib/labels';
import { useTontine } from '@/lib/queries';

const TABS = [
  { href: '', label: 'Tableau de bord' },
  { href: '/members', label: 'Membres' },
  { href: '/members/new', label: 'Inscrire un membre' },
  { href: '/invitations', label: 'Invitations' },
  { href: '/access-requests', label: 'Demandes d’accès' },
  { href: '/cycles', label: 'Cycles & cotisations' },
  { href: '/draw-order', label: 'Ordre de passage', fixedOrderOnly: true },
  { href: '/accounts', label: 'Comptes' },
  { href: '/messages', label: 'Messagerie' },
  { href: '/reports', label: 'Rapports' },
];

export default function TontineAdminLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const tontine = useTontine(id);
  const base = `/tontines/${id}/admin`;

  if (tontine.isPending) return <LoadingBlock />;
  // Tant que GET /tontines/{id} n'existe pas (404), on laisse l'accès aux écrans : l'API
  // contrôle de toute façon la propriété sur chaque route.
  if (tontine.isError && !isComingSoon(tontine.error)) {
    return <ErrorAlert error={tontine.error} onRetry={() => void tontine.refetch()} />;
  }
  const t = tontine.data;
  if (t && t.myRole !== 'ADMIN') {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden="true" />}
        title="Accès réservé à l’administrateur"
        description="Seul l’administrateur de cette tontine peut accéder à ces écrans."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/tontines/${id}`} className="hover:underline">
            {t?.name ?? 'Tontine'}
          </Link>{' '}
          › Administration
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t?.name ?? 'Administration'}</h1>
          {t ? <StatusBadge status={t.status} labels={TONTINE_STATUS_LABELS} /> : null}
        </div>
      </div>
      <nav aria-label="Administration de la tontine" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b px-1">
          {TABS.filter((tab) => !tab.fixedOrderOnly || !t || t.drawMode === 'FIXED_ORDER').map((tab) => {
            const href = `${base}${tab.href}`;
            const active = tab.href === '' ? pathname === base : pathname === href;
            return (
              <li key={tab.href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-mb-px inline-block border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </div>
  );
}
