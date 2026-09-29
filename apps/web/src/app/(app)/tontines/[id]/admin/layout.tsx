'use client';

import { EmptyState, LoadingBlock, cn } from '@tontine/ui';
import { ChevronRight, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorAlert, isComingSoon } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { type MessageKey, useI18n } from '@/lib/i18n';
import { useLabels } from '@/lib/i18n/labels';
import { useTontine } from '@/lib/queries';

const TABS: Array<{ href: string; key: string; fixedOrderOnly?: boolean }> = [
  { href: '', key: 'dashboard' },
  { href: '/members', key: 'members' },
  { href: '/members/new', key: 'register' },
  { href: '/invitations', key: 'invitations' },
  { href: '/access-requests', key: 'accessRequests' },
  { href: '/cycles', key: 'cycles' },
  { href: '/draw-order', key: 'drawOrder', fixedOrderOnly: true },
  { href: '/accounts', key: 'accounts' },
  { href: '/messages', key: 'messages' },
  { href: '/reports', key: 'reports' },
  { href: '/settings', key: 'settings' },
];

/** Espace d'administration d'une tontine : réservé à son administrateur (contrôlé aussi par l'API). */
export default function TontineAdminLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const labels = useLabels();
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const tontine = useTontine(id);
  const base = `/tontines/${id}/admin`;

  if (tontine.isPending) return <LoadingBlock />;
  // 404 toléré : l'API contrôle de toute façon la propriété sur chaque route.
  if (tontine.isError && !isComingSoon(tontine.error)) {
    return <ErrorAlert error={tontine.error} onRetry={() => void tontine.refetch()} />;
  }
  const x = tontine.data;
  if (x && x.myRole !== 'ADMIN') {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden="true" />}
        title={t('adminT.restrictedTitle')}
        description={t('adminT.restrictedBody')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <nav aria-label={t('adminT.breadcrumbNav')} className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link
                href={`/tontines/${id}`}
                className="text-info underline-offset-4 hover:underline"
              >
                {x?.name ?? '—'}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li aria-current="page">{t('adminT.breadcrumb')}</li>
          </ol>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-h1">{x?.name ?? t('adminT.breadcrumb')}</h1>
          {x ? <StatusBadge status={x.status} labels={labels.tontineStatus} /> : null}
        </div>
      </div>
      <nav aria-label={t('adminT.navLabel')} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b px-1">
          {TABS.filter((tab) => !tab.fixedOrderOnly || !x || x.drawMode === 'FIXED_ORDER').map(
            (tab) => {
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
                        ? 'border-nav-indicator text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`adminT.tabs.${tab.key}` as MessageKey)}
                  </Link>
                </li>
              );
            },
          )}
        </ul>
      </nav>
      {children}
    </div>
  );
}
