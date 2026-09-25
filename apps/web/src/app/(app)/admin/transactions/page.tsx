'use client';

import { TRANSACTION_STATUSES, TRANSACTION_TYPES } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, Label, Select } from '@tontine/ui';
import { useState } from 'react';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { ListResponse, TransactionView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { MOVEMENT_CONTEXT_LABELS, TRANSACTION_STATUS_LABELS, label } from '@/lib/labels';

const TYPE_LABELS: Record<string, string> = {
  ...MOVEMENT_CONTEXT_LABELS,
  CONTRIBUTION: 'Cotisation',
  PAYOUT: 'Versement',
};

/** Transactions (super-admin) : consultation et annulation par contre-passation. */
export default function AdminTransactionsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const query = useQuery({
    queryKey: ['admin', 'transactions', status, type],
    queryFn: () =>
      api.get<ListResponse<TransactionView>>('/admin/transactions', { query: { status, type } }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transactions"
        description="Une annulation crée une écriture de contre-passation (aucune suppression)."
      />
      <div className="grid max-w-lg grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tx-status">Statut</Label>
          <Select id="tx-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            {TRANSACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TRANSACTION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-type">Type</Label>
          <Select id="tx-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tous</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(TYPE_LABELS, t)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <QueryState
        query={query}
        comingSoonTitle="Consultation des transactions bientôt disponible"
        isEmpty={(d) => d.data.length === 0}
        empty={
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune transaction.</p>
        }
      >
        {(d) => (
          <Card>
            <CardContent className="pt-4">
              <SimpleTable
                rows={d.data}
                rowKey={(t) => t.id}
                columns={[
                  { header: 'Date', cell: (t) => formatDateTime(t.createdAt) },
                  { header: 'Type', cell: (t) => label(TYPE_LABELS, t.type) },
                  { header: 'Montant', cell: (t) => <Money value={t.amount} /> },
                  {
                    header: 'Statut',
                    cell: (t) => (
                      <StatusBadge status={t.status} labels={TRANSACTION_STATUS_LABELS} />
                    ),
                  },
                  { header: 'Identifiant', cell: (t) => <code className="text-xs">{t.id}</code> },
                  {
                    header: 'Actions',
                    srOnlyHeader: true,
                    className: 'text-right',
                    cell: (t) =>
                      t.status === 'COMPLETED' ? (
                        <ActionDialog
                          trigger="Annuler"
                          title="Annuler cette transaction ?"
                          description="Une écriture inverse sera passée dans le grand livre."
                          reason={{ label: 'Motif', required: true }}
                          confirmVariant="destructive"
                          confirmLabel="Contre-passer"
                          successMessage="Transaction annulée"
                          onConfirm={async (reason) => {
                            await api.post(`/admin/transactions/${t.id}/reverse`, { reason });
                            await queryClient.invalidateQueries({
                              queryKey: ['admin', 'transactions'],
                            });
                          }}
                        />
                      ) : null,
                  },
                ]}
              />
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
