'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  LoadingBlock,
  ProgressBar,
  cn,
} from '@tontine/ui';
import { ArrowDownLeft, ArrowUpRight, Bell, CalendarClock, Lock, Users } from 'lucide-react';
import Link from 'next/link';
import { Amount } from '@/components/amount';
import { QueryState } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { PayDialog } from '@/components/tontines/pay-dialog';
import { api } from '@/lib/api';
import type { ListResponse, MovementView, NotificationView, TontineView } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import {
  PAYABLE_STATUSES,
  useCurrentUser,
  useMyContributions,
  useMyTontines,
  useWallet,
} from '@/lib/queries';

function KycBanner() {
  const user = useCurrentUser();
  const { t } = useI18n();
  if (!user || user.accessState !== 'ACTIVE_PENDING_KYC') return null;
  return (
    <Alert variant="warning" title={t('dashboard.kycBannerTitle')}>
      <p>{t('dashboard.kycBannerBody')}</p>
      <Button asChild size="sm" variant="secondary" className="mt-2">
        <Link href="/kyc">{t('dashboard.kycBannerCta')}</Link>
      </Button>
    </Alert>
  );
}

/** 1. Solde du wallet : disponible et bloqué (carte navy de la charte). */
function WalletCard() {
  const { t } = useI18n();
  const wallet = useWallet();
  return (
    <section
      aria-labelledby="wallet-title"
      className="rounded-lg bg-nav p-5 text-nav-foreground shadow-sm sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="wallet-title" className="text-sm font-medium">
          {t('dashboard.walletTitle')}
        </h2>
        <Link
          href="/wallet"
          className="rounded-sm text-xs text-gold-pale underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-ring"
        >
          {t('dashboard.seeWallet')}
        </Link>
      </div>
      {wallet.isPending ? (
        <div className="mt-4 h-20 animate-pulse rounded-md bg-nav-hover" />
      ) : wallet.isError ? (
        <p className="mt-4 text-sm text-gold-pale">{t('common.errorTitle')}</p>
      ) : (
        <>
          <p className="mt-3">
            <Amount value={wallet.data.balance} size="h1" onNavy />
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-nav-hover pt-4">
            <div>
              <dt className="text-xs">{t('dashboard.available')}</dt>
              <dd className="mt-0.5">
                <Amount value={wallet.data.available} size="h3" onNavy />
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-xs">
                <Lock className="size-3" aria-hidden="true" /> {t('dashboard.blocked')}
              </dt>
              <dd className="mt-0.5">
                <Amount value={wallet.data.blocked} size="h3" onNavy />
              </dd>
            </div>
          </dl>
          <Link
            href="/wallet?action=deposit"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-md border border-nav-foreground px-4 text-sm font-medium text-gold-pale transition-colors hover:bg-nav-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-ring"
          >
            <ArrowDownLeft className="size-4" aria-hidden="true" /> {t('dashboard.deposit')}
          </Link>
        </>
      )}
    </section>
  );
}

/** 2. Prochaine contribution : montant, date, CTA principal « Payer ma contribution ». */
function NextContribution() {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const mine = useMyContributions();
  const due = mine.contributions.filter((c) =>
    (PAYABLE_STATUSES as readonly string[]).includes(c.status),
  );
  const next = due[0];
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-info" aria-hidden="true" />
          {t('dashboard.nextTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {mine.isPending ? (
          <LoadingBlock />
        ) : !next ? (
          <p className="text-sm text-muted-foreground">{t('dashboard.nextNone')}</p>
        ) : (
          <>
            <div className="space-y-1">
              <p className="font-medium">{next.tontineName}</p>
              <Amount value={next.totalDue ?? next.amount} size="h2" />
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <StatusBadge status={next.status} labels={labels.contributionStatus} />
                <span>
                  {next.status === 'PENDING'
                    ? t('dashboard.nextDue', { date: f.date(next.dueDate) })
                    : t('dashboard.nextLate', { date: f.date(next.dueDate) })}
                </span>
              </div>
            </div>
            <div className="mt-auto">
              {next.paymentStatus === 'PROCESSING' ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t('dashboard.processing')}
                </p>
              ) : (
                <PayDialog
                  label={t('dashboard.payCta')}
                  path={`/tontines/${next.tontineId}/contributions/${next.id}/pay`}
                  amount={next.totalDue ?? next.amount}
                  successMessage={t('tontine.paySuccess')}
                  variant="primary"
                  size="lg"
                  className="w-full"
                  summary={t('tontine.paySummary', {
                    cycle: next.cycleNumber ?? '',
                    name: next.tontineName,
                  })}
                />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TontineRow({ tontine }: { tontine: TontineView }) {
  const { t } = useI18n();
  const labels = useLabels();
  const current = tontine.currentCycleNumber ?? 0;
  const total = tontine.totalCycles ?? tontine.maxMembers;
  const done = tontine.status === 'COMPLETED' ? total : Math.max(current - 1, 0);
  return (
    <Link
      href={`/tontines/${tontine.id}`}
      className="block rounded-md border p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{tontine.name}</p>
        <StatusBadge status={tontine.status} labels={labels.tontineStatus} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        <Amount value={tontine.contribution} /> · {labels.frequency[tontine.frequency]}
      </p>
      <ProgressBar
        className="mt-3"
        value={done}
        max={total}
        label={t('tontines.progress')}
        valueText={t('tontines.cycleOf', { current, total })}
        showLabel
      />
    </Link>
  );
}

/** 3. Tontines actives (hors terminées et annulées). */
function ActiveTontines() {
  const { t } = useI18n();
  const tontines = useMyTontines();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-info" aria-hidden="true" /> {t('dashboard.activeTitle')}
        </CardTitle>
        <Link
          href="/tontines"
          className="text-sm font-medium text-info underline underline-offset-4"
        >
          {t('dashboard.seeAll')}
        </Link>
      </CardHeader>
      <CardContent>
        <QueryState
          query={tontines}
          isEmpty={(d) =>
            d.data.filter((x) => !['COMPLETED', 'CANCELLED'].includes(x.status)).length === 0
          }
          empty={
            <EmptyState
              icon={<Users aria-hidden="true" />}
              title={t('dashboard.activeEmpty')}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/tontines">{t('tontines.title')}</Link>
                </Button>
              }
            />
          }
        >
          {(d) => (
            <ul className="grid gap-3 sm:grid-cols-2">
              {d.data
                .filter((x) => !['COMPLETED', 'CANCELLED'].includes(x.status))
                .slice(0, 4)
                .map((x) => (
                  <li key={x.id}>
                    <TontineRow tontine={x} />
                  </li>
                ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** 4. Historique récent : derniers mouvements du wallet. */
function RecentHistory() {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const query = useQuery({
    queryKey: ['wallet-movements', 'recent'],
    queryFn: () =>
      api.get<ListResponse<MovementView>>('/me/wallet/movements', { query: { limit: 5 } }),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('dashboard.historyTitle')}</CardTitle>
        <Link href="/wallet" className="text-sm font-medium text-info underline underline-offset-4">
          {t('dashboard.seeAll')}
        </Link>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={<p className="text-sm text-muted-foreground">{t('dashboard.historyEmpty')}</p>}
        >
          {(d) => (
            <ul className="divide-y">
              {d.data.map((m) => {
                const incoming = m.direction === 'IN';
                const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
                return (
                  <li key={m.id} className="flex items-center gap-3 py-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-full',
                        incoming
                          ? 'bg-success-soft text-success'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m.contextLabel ?? labels.movementContext[m.context] ?? m.context}
                      </p>
                      <p className="text-xs text-muted-foreground">{f.relative(m.createdAt)}</p>
                    </div>
                    {m.direction === 'NEUTRAL' ? (
                      <Amount value={m.amount} />
                    ) : (
                      <Amount value={m.amount} signed={incoming ? 'in' : 'out'} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** 5. Notifications récentes. */
function RecentNotifications() {
  const { t } = useI18n();
  const f = useFormat();
  const query = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () =>
      api.get<ListResponse<NotificationView, { unread: number }>>('/me/notifications', {
        query: { limit: 5 },
      }),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4 text-info" aria-hidden="true" />
          {t('dashboard.notificationsTitle')}
        </CardTitle>
        <Link
          href="/notifications"
          className="text-sm font-medium text-info underline underline-offset-4"
        >
          {t('dashboard.seeAll')}
        </Link>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="text-sm text-muted-foreground">{t('dashboard.notificationsEmpty')}</p>
          }
        >
          {(d) => (
            <ul className="divide-y">
              {d.data.map((n) => (
                <li key={n.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn('text-sm', !n.readAt && 'font-medium')}>
                      {!n.readAt ? (
                        <span
                          className="mr-1.5 inline-block size-2 rounded-full bg-info align-middle"
                          aria-hidden="true"
                        />
                      ) : null}
                      {!n.readAt ? (
                        <span className="sr-only">{t('dashboard.unread')} : </span>
                      ) : null}
                      {n.title}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {f.relative(n.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** Accueil membre : solde, prochaine contribution, tontines, historique, notifications. */
export default function DashboardPage() {
  const user = useCurrentUser();
  const { t } = useI18n();
  const labels = useLabels();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h1">{t('dashboard.greeting', { name: user?.firstName ?? '' })}</h1>
        <p className="text-sm text-muted-foreground">
          {t('dashboard.kycLevel', { level: labels.kycLevel[user?.kycLevel ?? 'NONE'] ?? '—' })}
        </p>
      </div>
      <KycBanner />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <WalletCard />
        </div>
        <div className="lg:col-span-2">
          <NextContribution />
        </div>
      </div>
      <ActiveTontines />
      <div className="grid gap-6 lg:grid-cols-2">
        <RecentHistory />
        <RecentNotifications />
      </div>
    </div>
  );
}
