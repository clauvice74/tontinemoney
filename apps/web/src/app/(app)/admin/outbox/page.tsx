'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@tontine/ui';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import type { DeadEventView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

/** DLQ de l'outbox : événements en échec définitif, remise en file après correction. */
export default function AdminOutboxPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'outbox'],
    queryFn: () => api.get<{ data: DeadEventView[] }>('/admin/outbox/dead'),
  });
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Événements en échec (DLQ)"
          description="Après 8 tentatives, un événement passe en DLQ. Les consommateurs sont idempotents : la remise en file est sans risque."
        />
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucun événement en échec.
            </p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(e) => e.id}
                  columns={[
                    { header: 'Créé', cell: (e) => formatDateTime(e.createdAt) },
                    { header: 'Type', cell: (e) => <code className="text-xs">{e.eventType}</code> },
                    { header: 'Tentatives', cell: (e) => e.attempts },
                    {
                      header: 'Dernière erreur',
                      cell: (e) => <span className="text-xs">{e.lastError ?? '—'}</span>,
                    },
                    {
                      header: 'Action',
                      srOnlyHeader: true,
                      className: 'text-right',
                      cell: (e) => (
                        <ActionDialog
                          trigger="Remettre en file"
                          triggerVariant="outline"
                          title="Remettre l’événement en file ?"
                          successMessage="Événement remis en file"
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
