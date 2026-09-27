'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, Label, Select, toast } from '@tontine/ui';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { formatDate, formatDateTime } from '@/lib/format';

interface ReportRow {
  id: string;
  kind: 'INTERNAL' | 'PSP';
  businessDate: string;
  status: string;
  checkedCount: number;
  discrepancyCount: number;
  alert: boolean;
  createdAt: string;
}

/** US-6.6 / US-7.6 — rapports de réconciliation interne et PSP, exports CSV / PDF. */
export default function AdminReconciliationPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'INTERNAL' | 'PSP'>('INTERNAL');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['admin', 'reconciliation'],
    queryFn: () => api.get<{ data: ReportRow[] }>('/admin/reconciliation'),
  });

  async function run() {
    setBusy(true);
    try {
      const r = await api.post<{ discrepancies: number; alert: boolean }>(
        '/admin/reconciliation/run',
        { kind, ...(kind === 'PSP' && date ? { date } : {}) },
      );
      toast[r.alert ? 'error' : 'success'](
        `${r.discrepancies} écart(s)${r.alert ? ' — alerte levée' : ''}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['admin', 'reconciliation'] });
    } finally {
      setBusy(false);
    }
  }

  async function download(r: ReportRow, format: 'csv' | 'pdf') {
    const blob = await api.get<Blob>(`/admin/reconciliation/${r.id}`, {
      query: { format },
      responseType: 'blob',
    });
    saveBlob(blob, `reconciliation-${r.kind.toLowerCase()}-${r.businessDate}.${format}`);
  }

  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Réconciliation"
          description="Interne : partie double, soldes, blocages, paiements. PSP : relevés du prestataire (simulé) contre paiements internes."
        />
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="rec-kind">Type</Label>
              <Select
                id="rec-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'INTERNAL' | 'PSP')}
              >
                <option value="INTERNAL">Interne</option>
                <option value="PSP">PSP</option>
              </Select>
            </div>
            {kind === 'PSP' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-date">Journée (UTC, défaut : veille)</Label>
                <Input
                  id="rec-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            ) : null}
            <Button onClick={run} disabled={busy}>
              {busy ? 'Calcul…' : 'Lancer'}
            </Button>
          </CardContent>
        </Card>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">Aucun rapport.</p>}
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(r) => r.id}
                  columns={[
                    { header: 'Journée', cell: (r) => formatDate(r.businessDate) },
                    { header: 'Type', cell: (r) => (r.kind === 'PSP' ? 'PSP' : 'Interne') },
                    { header: 'Contrôlés', cell: (r) => r.checkedCount },
                    {
                      header: 'Écarts',
                      cell: (r) =>
                        r.discrepancyCount ? (
                          <Badge variant={r.alert ? 'destructive' : 'warning'}>
                            {r.discrepancyCount}
                          </Badge>
                        ) : (
                          <Badge variant="success">0</Badge>
                        ),
                    },
                    { header: 'Généré', cell: (r) => formatDateTime(r.createdAt) },
                    {
                      header: 'Exports',
                      srOnlyHeader: true,
                      className: 'text-right space-x-2',
                      cell: (r) => (
                        <>
                          <Button size="sm" variant="outline" onClick={() => download(r, 'csv')}>
                            CSV
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => download(r, 'pdf')}>
                            PDF
                          </Button>
                        </>
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
