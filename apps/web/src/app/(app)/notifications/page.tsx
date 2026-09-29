'use client';

import { NOTIFICATION_FILTERS, type NotificationFilter } from '@tontine/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  CursorPagination,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  cn,
  toast,
} from '@tontine/ui';
import {
  Bell,
  CheckCheck,
  CreditCard,
  IdCard,
  MessageSquare,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { api } from '@/lib/api';
import type { ListResponse, NotificationView } from '@/lib/api/types';
import { formatError } from '@/lib/forms';
import { type MessageKey, useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';

const CATEGORY_ICON: Record<string, typeof Bell> = {
  PAYMENT: CreditCard,
  WALLET: Wallet,
  KYC: IdCard,
  TONTINE: Users,
  SECURITY: ShieldCheck,
  MESSAGE: MessageSquare,
};

/** Jour calendaire local (AAAA-MM-JJ) pour regrouper la liste. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function NotificationIcon({ n }: { n: NotificationView }) {
  const Icon = CATEGORY_ICON[n.category] ?? Bell;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full',
        n.priority === 'URGENT' ? 'bg-destructive-soft text-destructive' : 'bg-secondary text-info',
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** Notifications (US-8.x, A-60) : liste chronologique, filtres, voir, marquer comme lu. */
export default function NotificationsPage() {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<NotificationFilter | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [opened, setOpened] = useState<NotificationView | null>(null);
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['notifications', 'list', filter, unreadOnly, pagination.cursor],
    queryFn: () =>
      api.get<ListResponse<NotificationView, { unread: number }>>('/me/notifications', {
        query: {
          unread: unreadOnly ? 'true' : undefined,
          filter: filter ?? undefined,
          cursor: pagination.cursor,
          limit: 20,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`),
    onSuccess: invalidate,
    onError: (e) => toast.error(t('notifs.actionFailed'), formatError(e)),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSuccess: async () => {
      await invalidate();
      toast.success(t('notifs.markedAll'));
    },
    onError: (e) => toast.error(t('notifs.actionFailed'), formatError(e)),
  });

  function view(n: NotificationView) {
    setOpened(n);
    if (!n.readAt) markRead.mutate(n.id);
  }

  function pick(next: NotificationFilter | null) {
    setFilter(next);
    pagination.reset();
  }

  const unread = query.data?.meta?.unread ?? 0;
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const dayLabel = (iso: string) => {
    const k = dayKey(iso);
    return k === today ? t('notifs.today') : k === yesterday ? t('notifs.yesterday') : f.date(iso);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-h1">{t('notifs.title')}</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {unread > 0 ? t('notifs.unreadCount', { count: unread }) : t('notifs.allRead')}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => markAll.mutate()}
          loading={markAll.isPending}
          disabled={unread === 0}
        >
          <CheckCheck aria-hidden="true" /> {t('notifs.markAll')}
        </Button>
      </header>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('notifs.filtersLabel')}>
          {([null, ...NOTIFICATION_FILTERS] as const).map((key) => {
            const active = filter === key;
            return (
              <button
                key={key ?? 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => pick(key)}
                className={cn(
                  'h-8 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-muted',
                )}
              >
                {key ? t(`notifs.filters.${key}` as MessageKey) : t('notifs.all')}
              </button>
            );
          })}
        </div>
        <label className="flex w-fit items-center gap-2 text-sm">
          <Checkbox
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.currentTarget.checked);
              pagination.reset();
            }}
          />
          {t('notifs.unreadOnly')}
        </label>
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <EmptyState
            icon={<Bell aria-hidden="true" />}
            title={filter || unreadOnly ? t('notifs.empty') : t('notifs.emptyAll')}
          />
        }
      >
        {(d) => (
          <>
            <ol className="space-y-2">
              {d.data.map((n, i) => {
                const prev = d.data[i - 1];
                const newDay = !prev || dayKey(prev.createdAt) !== dayKey(n.createdAt);
                return (
                  <li key={n.id} className="space-y-2">
                    {newDay ? (
                      <h2 className="pt-2 text-xs font-medium uppercase text-muted-foreground">
                        {dayLabel(n.createdAt)}
                      </h2>
                    ) : null}
                    <Card className={cn(!n.readAt && 'border-info/40 bg-secondary/40')}>
                      <CardContent className="flex gap-3 pt-4">
                        <NotificationIcon n={n} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={cn('text-sm', !n.readAt && 'font-medium')}>
                              {!n.readAt ? (
                                <span className="sr-only">{t('notifs.unread')} : </span>
                              ) : null}
                              {n.title}
                            </p>
                            {n.priority === 'URGENT' || n.priority === 'HIGH' ? (
                              <Badge variant={n.priority === 'URGENT' ? 'destructive' : 'warning'}>
                                {n.priority === 'URGENT'
                                  ? t('notifs.urgent')
                                  : t('notifs.important')}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                            <span className="text-xs text-muted-foreground">
                              {labels.notificationCategory[n.category] ?? n.category} ·{' '}
                              {f.relative(n.createdAt)}
                            </span>
                            <span className="ml-auto flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => view(n)}>
                                {t('notifs.view')}
                                <span className="sr-only"> — {n.title}</span>
                              </Button>
                              {!n.readAt ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => markRead.mutate(n.id)}
                                  disabled={markRead.isPending}
                                >
                                  {t('notifs.markRead')}
                                  <span className="sr-only"> — {n.title}</span>
                                </Button>
                              ) : null}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
            <CursorPagination
              page={pagination.page}
              hasPrevious={pagination.hasPrevious}
              hasNext={!!d.page?.nextCursor}
              onPrevious={pagination.previous}
              onNext={() => pagination.next(d.page?.nextCursor)}
              loading={query.isFetching}
            />
          </>
        )}
      </QueryState>

      <Dialog open={!!opened} onOpenChange={(o) => (o ? null : setOpened(null))}>
        <DialogContent>
          {opened ? (
            <>
              <DialogHeader>
                <DialogTitle>{opened.title}</DialogTitle>
                <DialogDescription>
                  {labels.notificationCategory[opened.category] ?? opened.category} ·{' '}
                  {t('notifs.receivedOn', { date: f.dateTime(opened.createdAt) })}
                </DialogDescription>
              </DialogHeader>
              <p className="whitespace-pre-line text-sm">{opened.body}</p>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpened(null)}>
                  {t('notifs.close')}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
