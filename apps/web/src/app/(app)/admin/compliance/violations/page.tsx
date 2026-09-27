'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@tontine/ui';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { OPERATION_TYPE_LABELS, label } from '@/lib/labels';

interface Violation {
  id: string;
  memberId: string;
  operationType: string;
  ruleCode: string;
  action: 'BLOCKED' | 'SUSPENDED' | 'ALERTED';
  details: { message?: string } | null;
  createdAt: string;
}

/** US-9.4 — violations détectées : blocage, suspension, alerte (changement de pays suspect). */
export default function AdminViolationsPage() {
  const query = useQuery({
    queryKey: ['admin', 'violations'],
    queryFn: () => api.get<{ data: Violation[] }>('/admin/compliance/violations'),
  });
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Violations de conformité"
          description="5 violations en 24 h entraînent la suspension automatique du membre."
        />
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">Aucune violation.</p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(v) => v.id}
                  columns={[
                    { header: 'Date', cell: (v) => formatDateTime(v.createdAt) },
                    {
                      header: 'Membre',
                      cell: (v) => <code className="text-xs">{v.memberId.slice(0, 8)}</code>,
                    },
                    {
                      header: 'Opération',
                      cell: (v) => label(OPERATION_TYPE_LABELS, v.operationType),
                    },
                    { header: 'Règle', cell: (v) => <code className="text-xs">{v.ruleCode}</code> },
                    { header: 'Détail', cell: (v) => v.details?.message ?? '—' },
                    {
                      header: 'Action',
                      cell: (v) => (
                        <Badge
                          variant={
                            v.action === 'SUSPENDED'
                              ? 'destructive'
                              : v.action === 'BLOCKED'
                                ? 'warning'
                                : 'info'
                          }
                        >
                          {v.action === 'SUSPENDED'
                            ? 'Suspension'
                            : v.action === 'BLOCKED'
                              ? 'Blocage'
                              : 'Alerte'}
                        </Badge>
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
