'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CursorPagination,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  toast,
} from '@tontine/ui';
import { CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import type { ListResponse, NotificationView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { formatError } from '@/lib/forms';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';
import { NOTIFICATION_CATEGORY_LABELS, label } from '@/lib/labels';

const PRIORITY_VARIANT = {
  LOW: 'muted',
  MEDIUM: 'secondary',
  HIGH: 'warning',
  URGENT: 'destructive',
} as const;

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['notifications', 'list', unreadOnly, pagination.cursor],
    queryFn: () =>
      api.get<ListResponse<NotificationView, { unread: number }>>('/me/notifications', {
        query: { unread: unreadOnly ? 'true' : undefined, cursor: pagination.cursor, limit: 20 },
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`),
    onSuccess: invalidate,
    onError: (e) => toast.error('Action impossible', formatError(e)),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSuccess: async () => {
      await invalidate();
      toast.success('Toutes les notifications sont marquées comme lues');
    },
    onError: (e) => toast.error('Action impossible', formatError(e)),
  });

  const unread = query.data?.meta?.unread ?? 0;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={
          unread > 0
            ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}`
            : 'Tout est lu'
        }
        actions={
          <Button
            variant="outline"
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
            disabled={unread === 0}
          >
            <CheckCheck aria-hidden="true" /> Tout marquer comme lu
          </Button>
        }
      />
      <Tabs
        value={unreadOnly ? 'unread' : 'all'}
        onValueChange={(v) => {
          setUnreadOnly(v === 'unread');
          pagination.reset();
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="all">Toutes</TabsTrigger>
          <TabsTrigger value="unread">Non lues</TabsTrigger>
        </TabsList>
      </Tabs>
      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune notification.</p>
        }
      >
        {(d) => (
          <>
            <ul className="space-y-2">
              {d.data.map((n) => (
                <li key={n.id}>
                  <Card className={cn(!n.readAt && 'border-primary/40 bg-secondary/40')}>
                    <CardContent className="flex flex-col gap-2 pt-5 sm:flex-row sm:items-start">
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {!n.readAt ? (
                            <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                          ) : null}
                          <p className={cn('text-sm', !n.readAt && 'font-medium')}>
                            {!n.readAt ? <span className="sr-only">Non lue : </span> : null}
                            {n.title}
                          </p>
                          <Badge variant="outline">
                            {label(NOTIFICATION_CATEGORY_LABELS, n.category)}
                          </Badge>
                          {n.priority === 'HIGH' || n.priority === 'URGENT' ? (
                            <Badge variant={PRIORITY_VARIANT[n.priority]}>
                              {n.priority === 'URGENT' ? 'Urgent' : 'Important'}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="whitespace-pre-line text-sm text-muted-foreground">
                          {n.body}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(n.createdAt)}
                        </p>
                      </div>
                      {!n.readAt ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markRead.mutate(n.id)}
                          disabled={markRead.isPending}
                        >
                          Marquer comme lue
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
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
    </div>
  );
}
