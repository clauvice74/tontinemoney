'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@tontine/ui';
import { ActionDialog } from '@/components/action-dialog';
import { IdActionForm } from '@/components/admin/id-action-form';
import { QueryState } from '@/components/feedback';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import { FREQUENCY_LABELS, TONTINE_STATUS_LABELS, label } from '@/lib/labels';
import { qk, useMyTontines } from '@/lib/queries';

/** Pause / reprise des tontines (super-admin). */
export default function AdminTontinesPage() {
  const queryClient = useQueryClient();
  const tontines = useMyTontines();
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.tontines });

  return (
    <div className="space-y-6">
      <PageHeader title="Tontines" description="Mettre en pause ou reprendre une tontine (motif obligatoire)." />
      <Card>
        <CardHeader>
          <CardTitle>Tontines visibles</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState
            query={tontines}
            comingSoonTitle="Liste des tontines bientôt disponible"
            isEmpty={(d) => d.data.length === 0}
            empty={<p className="text-sm text-muted-foreground">Aucune tontine.</p>}
          >
            {(d) => (
              <SimpleTable
                rows={d.data}
                rowKey={(t) => t.id}
                columns={[
                  { header: 'Nom', cell: (t) => <span className="font-medium">{t.name}</span> },
                  {
                    header: 'Cotisation',
                    cell: (t) => (
                      <>
                        <Money value={t.contribution} /> · {label(FREQUENCY_LABELS, t.frequency)}
                      </>
                    ),
                  },
                  { header: 'Membres', cell: (t) => `${t.memberCount}/${t.maxMembers}` },
                  { header: 'Statut', cell: (t) => <StatusBadge status={t.status} labels={TONTINE_STATUS_LABELS} /> },
                  {
                    header: 'Actions',
                    srOnlyHeader: true,
                    className: 'text-right',
                    cell: (t) =>
                      t.status === 'ACTIVE' ? (
                        <ActionDialog
                          trigger="Mettre en pause"
                          title={`Mettre « ${t.name} » en pause ?`}
                          reason={{ label: 'Motif', required: true }}
                          confirmVariant="destructive"
                          confirmLabel="Mettre en pause"
                          successMessage="Tontine en pause"
                          onConfirm={async (reason) => {
                            await api.post(`/admin/tontines/${t.id}/pause`, { reason });
                            await refresh();
                          }}
                        />
                      ) : t.status === 'PAUSED' ? (
                        <ActionDialog
                          trigger="Reprendre"
                          title={`Reprendre « ${t.name} » ?`}
                          reason={{ label: 'Motif', required: true }}
                          confirmLabel="Reprendre"
                          successMessage="Tontine reprise"
                          onConfirm={async (reason) => {
                            await api.post(`/admin/tontines/${t.id}/resume`, { reason });
                            await refresh();
                          }}
                        />
                      ) : null,
                  },
                ]}
              />
            )}
          </QueryState>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <IdActionForm
          title="Mettre en pause par identifiant"
          idLabel="Identifiant de la tontine"
          submitLabel="Mettre en pause"
          successMessage="Tontine en pause"
          destructive
          onSubmit={(id, reason) => api.post(`/admin/tontines/${id}/pause`, { reason })}
        />
        <IdActionForm
          title="Reprendre par identifiant"
          idLabel="Identifiant de la tontine"
          submitLabel="Reprendre"
          successMessage="Tontine reprise"
          onSubmit={(id, reason) => api.post(`/admin/tontines/${id}/resume`, { reason })}
        />
      </div>
    </div>
  );
}
