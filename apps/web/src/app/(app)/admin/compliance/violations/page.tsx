'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@tontine/ui';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';

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
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const query = useQuery({
    queryKey: ['admin', 'violations'],
    queryFn: () => api.get<{ data: Violation[] }>('/admin/compliance/violations'),
  });
  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-h1">{t('complianceUi.violationsTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('complianceUi.violationsDescription')}</p>
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('complianceUi.violationsEmpty')}
            </p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(v) => v.id}
                  columns={[
                    { header: t('complianceUi.date'), cell: (v) => f.dateTime(v.createdAt) },
                    {
                      header: t('complianceUi.member'),
                      cell: (v) => <code className="text-xs">{v.memberId.slice(0, 8)}</code>,
                    },
                    {
                      header: t('complianceUi.operation'),
                      cell: (v) => labels.operationType[v.operationType] ?? v.operationType,
                    },
                    {
                      header: t('complianceUi.rule'),
                      cell: (v) => <code className="text-xs">{v.ruleCode}</code>,
                    },
                    { header: t('complianceUi.detail'), cell: (v) => v.details?.message ?? '—' },
                    {
                      header: t('complianceUi.action'),
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
                            ? t('complianceUi.suspension')
                            : v.action === 'BLOCKED'
                              ? t('complianceUi.block')
                              : t('complianceUi.alert')}
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
