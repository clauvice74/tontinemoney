'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, Input, Label, Select } from '@tontine/ui';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import type { AuditLogView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

/** Journal d'audit (lecture seule) : actions sensibles, refus d'accès, décisions. */
export default function AdminAuditPage() {
  const [resourceType, setResourceType] = useState('');
  const [result, setResult] = useState('');
  const query = useQuery({
    queryKey: ['admin', 'audit', resourceType, result],
    queryFn: () =>
      api.get<{ data: AuditLogView[] }>('/admin/audit-logs', {
        query: { resourceType: resourceType || undefined, result: result || undefined, limit: 200 },
      }),
  });
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Journal d’audit"
          description="Immuable. Les secrets, jetons et documents n’y figurent jamais."
        />
        <div className="grid max-w-lg grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="audit-resource">Ressource</Label>
            <Input
              id="audit-resource"
              placeholder="ex. tontine, user, payment"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-result">Résultat</Label>
            <Select id="audit-result" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="">Tous</option>
              <option value="SUCCESS">Succès</option>
              <option value="DENIED">Refusé</option>
              <option value="FAILURE">Échec</option>
            </Select>
          </div>
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">Aucune entrée.</p>}
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(a) => a.id}
                  columns={[
                    { header: 'Date', cell: (a) => formatDateTime(a.createdAt) },
                    { header: 'Action', cell: (a) => <code className="text-xs">{a.action}</code> },
                    {
                      header: 'Ressource',
                      cell: (a) =>
                        `${a.resourceType}${a.resourceId ? ` · ${a.resourceId.slice(0, 8)}` : ''}`,
                    },
                    {
                      header: 'Acteur',
                      cell: (a) =>
                        `${a.actorRole ?? '—'}${a.actorId ? ` · ${a.actorId.slice(0, 8)}` : ''}`,
                    },
                    {
                      header: 'Résultat',
                      cell: (a) => (
                        <Badge
                          variant={
                            a.result === 'SUCCESS'
                              ? 'success'
                              : a.result === 'DENIED'
                                ? 'warning'
                                : 'destructive'
                          }
                        >
                          {a.result}
                        </Badge>
                      ),
                    },
                    { header: 'IP', cell: (a) => a.ip ?? '—' },
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
