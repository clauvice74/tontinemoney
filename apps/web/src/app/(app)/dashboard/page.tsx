'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingBlock,
} from '@tontine/ui';
import { ArrowDownLeft, CalendarClock, Lock, Wallet } from 'lucide-react';
import Link from 'next/link';
import { QueryState } from '@/components/feedback';
import { Money } from '@/components/money';
import { PageHeader, StatCard } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type {
  ContributionView,
  ListResponse,
  MemberTontineDashboard,
  NotificationView,
} from '@/lib/api/types';
import { formatDate, formatRelative } from '@/lib/format';
import {
  CONTRIBUTION_STATUS_LABELS,
  FREQUENCY_LABELS,
  KYC_LEVEL_LABELS,
  TONTINE_STATUS_LABELS,
  label,
} from '@/lib/labels';
import { formatMoneyView } from '@/lib/money';
import { useCurrentUser, useMyTontines, useWallet } from '@/lib/queries';

function KycBanner() {
  const user = useCurrentUser();
  if (!user || user.accessState !== 'ACTIVE_PENDING_KYC') return null;
  return (
    <Alert variant="warning" title="Vérifiez votre identité" className="mb-6">
      <p>
        Votre compte est actif, mais vous devez compléter la vérification d’identité (KYC) pour
        déposer, cotiser et rejoindre des tontines.
      </p>
      <Button asChild size="sm" className="mt-2">
        <Link href="/kyc">Commencer la vérification</Link>
      </Button>
    </Alert>
  );
}

/**
 * Prochaines échéances : agrégées depuis la vue membre du tableau de bord de chaque tontine
 * (`GET /tontines/{id}/dashboard` → `myContributions`).
 */
function UpcomingContributions() {
  const tontines = useMyTontines();
  const list = tontines.data?.data ?? [];
  const dashboards = useQueries({
    queries: list.map((t) => ({
      queryKey: ['tontines', t.id, 'dashboard', 'member'],
      queryFn: () => api.get<MemberTontineDashboard>(`/tontines/${t.id}/dashboard`),
    })),
  });
  const upcoming: ContributionView[] = dashboards
    .flatMap((q, i) =>
      (q.data?.myContributions ?? []).map((c) => ({
        ...c,
        tontineName: c.tontineName ?? list[i]?.name,
      })),
    )
    .filter((c) => c.status === 'PENDING' || c.status === 'LATE')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 5);
  const pending = tontines.isPending || dashboards.some((q) => q.isPending);
  const combined = {
    data: upcoming,
    error: tontines.error,
    isPending: pending,
    isError: tontines.isError,
    refetch: tontines.refetch,
  };
  return (
    <QueryState
      query={combined}
      comingSoonTitle="Échéancier bientôt disponible"
      isEmpty={(d) => d.length === 0}
      empty={<p className="text-sm text-muted-foreground">Aucune échéance à venir.</p>}
    >
      {(d) => (
        <ul className="divide-y">
          {d.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <p className="font-medium">{c.tontineName ?? 'Tontine'}</p>
                <p className="text-xs text-muted-foreground">
                  Cycle {c.cycleNumber ?? '—'} · échéance {formatDate(c.dueDate)}
                </p>
              </div>
              <div className="text-right">
                <Money value={c.amount} className="font-medium" />
                <div>
                  <StatusBadge status={c.status} labels={CONTRIBUTION_STATUS_LABELS} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

function RecentNotifications() {
  const query = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () =>
      api.get<ListResponse<NotificationView, { unread: number }>>('/me/notifications', {
        query: { limit: 5 },
      }),
  });
  return (
    <QueryState
      query={query}
      isEmpty={(d) => d.data.length === 0}
      empty={<p className="text-sm text-muted-foreground">Aucune notification.</p>}
    >
      {(d) => (
        <ul className="divide-y">
          {d.data.map((n) => (
            <li key={n.id} className="py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className={n.readAt ? 'text-sm' : 'text-sm font-medium'}>
                  {!n.readAt ? <span className="sr-only">Non lue : </span> : null}
                  {n.title}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(n.createdAt)}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

export default function DashboardPage() {
  const user = useCurrentUser();
  const wallet = useWallet();
  const tontines = useMyTontines();

  return (
    <div>
      <PageHeader
        title={`Bonjour ${user?.firstName ?? ''}`}
        description={`Niveau de vérification : ${label(KYC_LEVEL_LABELS, user?.kycLevel)}`}
        actions={
          <Button asChild>
            <Link href="/wallet?action=deposit">
              <ArrowDownLeft aria-hidden="true" /> Déposer
            </Link>
          </Button>
        }
      />
      <KycBanner />

      <section aria-label="Solde" className="mb-6 grid gap-4 sm:grid-cols-3">
        {wallet.isPending ? (
          <LoadingBlock className="sm:col-span-3" />
        ) : wallet.isError ? (
          <div className="sm:col-span-3">
            <QueryState query={wallet}>{() => null}</QueryState>
          </div>
        ) : (
          <>
            <StatCard
              label="Solde total"
              value={formatMoneyView(wallet.data.balance)}
              icon={<Wallet />}
            />
            <StatCard
              label="Disponible"
              value={formatMoneyView(wallet.data.available)}
              hint="Utilisable pour cotiser, retirer ou transférer"
            />
            <StatCard
              label="Bloqué"
              value={formatMoneyView(wallet.data.blocked)}
              icon={<Lock />}
              hint="Réservé pour des opérations en cours"
            />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Mes tontines</CardTitle>
            <Button variant="link" asChild className="h-auto p-0">
              <Link href="/tontines">Tout voir</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <QueryState
              query={tontines}
              comingSoonTitle="Tontines bientôt disponibles"
              isEmpty={(d) => d.data.length === 0}
              empty={
                <p className="text-sm text-muted-foreground">
                  Vous ne participez à aucune tontine pour le moment.
                </p>
              }
            >
              {(d) => (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {d.data.slice(0, 4).map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/tontines/${t.id}`}
                        className="block rounded-lg border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{t.name}</p>
                          <StatusBadge status={t.status} labels={TONTINE_STATUS_LABELS} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          <Money value={t.contribution} /> · {label(FREQUENCY_LABELS, t.frequency)}
                        </p>
                        {t.myRole === 'ADMIN' ? (
                          <Badge variant="secondary" className="mt-2">
                            Administrateur
                          </Badge>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </QueryState>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" aria-hidden="true" /> Prochaines
              échéances
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UpcomingContributions />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Notifications récentes</CardTitle>
            <Button variant="link" asChild className="h-auto p-0">
              <Link href="/notifications">Tout voir</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <RecentNotifications />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
