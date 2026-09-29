'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, Input, Label, Select } from '@tontine/ui';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import type { AuditLogView } from '@/lib/api/types';
import { type MessageKey, useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';

/** Journal d'audit (lecture seule) : actions sensibles, refus d'accès, décisions. */
export default function AdminAuditPage() {
  const { t } = useI18n();
  const f = useFormat();
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
        <div className="space-y-1">
          <h1 className="text-h1">{t('ops.auditTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('ops.auditDescription')}</p>
        </div>
        <div className="grid max-w-lg grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="audit-resource">{t('ops.resource')}</Label>
            <Input
              id="audit-resource"
              placeholder={t('ops.resourcePlaceholder')}
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value.trim())}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-result">{t('ops.result')}</Label>
            <Select id="audit-result" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="">{t('ops.all')}</option>
              <option value="SUCCESS">{t('ops.results.SUCCESS')}</option>
              <option value="DENIED">{t('ops.results.DENIED')}</option>
              <option value="FAILURE">{t('ops.results.FAILURE')}</option>
            </Select>
          </div>
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">{t('ops.auditEmpty')}</p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(a) => a.id}
                  columns={[
                    { header: t('ops.date'), cell: (a) => f.dateTime(a.createdAt) },
                    {
                      header: t('ops.action'),
                      cell: (a) => <code className="text-xs">{a.action}</code>,
                    },
                    {
                      header: t('ops.resource'),
                      cell: (a) =>
                        `${a.resourceType}${a.resourceId ? ` · ${a.resourceId.slice(0, 8)}` : ''}`,
                    },
                    {
                      header: t('ops.actor'),
                      cell: (a) =>
                        `${a.actorRole ?? '—'}${a.actorId ? ` · ${a.actorId.slice(0, 8)}` : ''}`,
                    },
                    {
                      header: t('ops.result'),
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
                          {t(`ops.results.${a.result}` as MessageKey)}
                        </Badge>
                      ),
                    },
                    { header: t('ops.ip'), cell: (a) => a.ip ?? '—' },
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
