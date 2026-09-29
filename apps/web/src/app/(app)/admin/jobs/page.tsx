'use client';

import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, toast } from '@tontine/ui';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import type { JobView } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';

/** Tâches planifiées : consultation et exécution à la demande (démonstration, rattrapage). */
export default function AdminJobsPage() {
  const { t } = useI18n();
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
      toast.success(t('ops.jobDone', { name, status: r.status }));
    } catch {
      toast.error(t('ops.jobFailed', { name }));
    } finally {
      setRunning(null);
    }
  }

  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-h1">{t('ops.jobsTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('ops.jobsDescription')}</p>
        </div>
        <QueryState query={query}>
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(j) => j.name}
                  columns={[
                    {
                      header: t('ops.job'),
                      cell: (j) => <code className="text-xs">{j.name}</code>,
                    },
                    {
                      header: t('ops.cron'),
                      cell: (j) => <code className="text-xs">{j.cron}</code>,
                    },
                    { header: t('ops.description'), cell: (j) => j.description ?? '—' },
                    {
                      header: t('ops.lastResult'),
                      cell: (j) => <span className="text-xs">{last[j.name] ?? '—'}</span>,
                    },
                    {
                      header: t('ops.action'),
                      srOnlyHeader: true,
                      className: 'text-right',
                      cell: (j) => (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={running !== null}
                          onClick={() => run(j.name)}
                        >
                          {running === j.name ? t('ops.running') : t('ops.run')}
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
