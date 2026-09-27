'use client';

import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, toast } from '@tontine/ui';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import type { JobView } from '@/lib/api/types';

/** Tâches planifiées : consultation et exécution à la demande (démonstration, rattrapage). */
export default function AdminJobsPage() {
  const query = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: () => api.get<{ data: JobView[] }>('/admin/jobs'),
  });
  const [running, setRunning] = useState<string | null>(null);
  const [last, setLast] = useState<Record<string, string>>({});

  async function run(name: string) {
    setRunning(name);
    try {
      const r = await api.post<{ status: string; summary: Record<string, unknown> }>(
        `/admin/jobs/${encodeURIComponent(name)}/run`,
      );
      setLast((m) => ({ ...m, [name]: `${r.status} ${JSON.stringify(r.summary)}` }));
      toast.success(`Tâche ${name} : ${r.status}`);
    } catch {
      toast.error(`Échec de la tâche ${name}`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Tâches planifiées"
          description="Chaque tâche est protégée contre les exécutions concurrentes (verrou consultatif)."
        />
        <QueryState query={query}>
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(j) => j.name}
                  columns={[
                    { header: 'Tâche', cell: (j) => <code className="text-xs">{j.name}</code> },
                    {
                      header: 'Planification (cron)',
                      cell: (j) => <code className="text-xs">{j.cron}</code>,
                    },
                    { header: 'Description', cell: (j) => j.description ?? '—' },
                    {
                      header: 'Dernier résultat',
                      cell: (j) => <span className="text-xs">{last[j.name] ?? '—'}</span>,
                    },
                    {
                      header: 'Action',
                      srOnlyHeader: true,
                      className: 'text-right',
                      cell: (j) => (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={running !== null}
                          onClick={() => run(j.name)}
                        >
                          {running === j.name ? 'Exécution…' : 'Exécuter'}
                        </Button>
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
