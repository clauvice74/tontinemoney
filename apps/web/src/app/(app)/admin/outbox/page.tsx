'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@tontine/ui';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import type { DeadEventView } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';

/** DLQ de l'outbox : événements en échec définitif, remise en file après correction. */
export default function AdminOutboxPage() {
  const { t } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'outbox'],
    queryFn: () => api.get<{ data: DeadEventView[] }>('/admin/outbox/dead'),
  });
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-h1">{t('ops.outboxTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('ops.outboxDescription')}</p>
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">{t('ops.outboxEmpty')}</p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(e) => e.id}
                  columns={[
                    { header: t('ops.created'), cell: (e) => f.dateTime(e.createdAt) },
                    {
                      header: t('ops.type'),
                      cell: (e) => <code className="text-xs">{e.eventType}</code>,
                    },
                    { header: t('ops.attempts'), cell: (e) => e.attempts },
                    {
                      header: t('ops.lastError'),
                      cell: (e) => <span className="text-xs">{e.lastError ?? '—'}</span>,
                    },
                    {
                      header: t('ops.action'),
                      srOnlyHeader: true,
                      className: 'text-right',
                      cell: (e) => (
                        <ActionDialog
                          trigger={t('ops.requeue')}
                          triggerVariant="outline"
                          title={t('ops.requeueTitle')}
                          successMessage={t('ops.requeued')}
                          onConfirm={async () => {
                            await api.post(`/admin/outbox/${e.id}/requeue`);
                            await queryClient.invalidateQueries({ queryKey: ['admin', 'outbox'] });
                          }}
                        />
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </QueryState>
      </div>
    </RequireRole>
  );
}
