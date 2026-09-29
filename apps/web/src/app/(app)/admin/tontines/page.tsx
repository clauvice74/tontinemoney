'use client';

import { TONTINE_STATUSES } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tontine/ui';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ActionDialog } from '@/components/action-dialog';
import { Amount } from '@/components/amount';
import { QueryState } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { ListResponse, TontineView } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';

/** Actions du super-admin selon le statut : pause, reprise, relance de la clôture (A-61). */
function TontineActions({ x, onDone }: { x: TontineView; onDone: () => Promise<unknown> }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button asChild size="sm" variant="ghost">
        <Link href={`/tontines/${x.id}`}>
          {t('platform.tontines.view')}
          <span className="sr-only"> — {x.name}</span>
        </Link>
      </Button>
      {x.status === 'ACTIVE' ? (
        <>
          <ActionDialog
            trigger={t('platform.tontines.pause')}
            title={t('platform.tontines.pauseTitle', { name: x.name })}
            description={t('platform.tontines.pauseBody')}
            reason={{ label: t('platform.tontines.reason'), required: true }}
            confirmVariant="destructive"
            confirmLabel={t('platform.tontines.pause')}
            successMessage={t('platform.tontines.paused')}
            onConfirm={async (reason) => {
              await api.post(`/admin/tontines/${x.id}/pause`, { reason });
              await onDone();
            }}
          />
          <ActionDialog
            trigger={t('platform.tontines.close')}
            title={t('platform.tontines.closeTitle', { name: x.name })}
            description={t('platform.tontines.closeBody')}
            confirmLabel={t('platform.tontines.close')}
            successMessage={t('platform.tontines.closed')}
            onConfirm={async () => {
              const r = await api.post<{ closed: boolean; blockers: string[] }>(
                `/admin/tontines/${x.id}/close`,
              );
              await onDone();
              if (!r.closed)
                throw new Error(
                  t('platform.tontines.closeBlocked', { blockers: r.blockers.join(' ; ') }),
                );
            }}
          />
        </>
      ) : x.status === 'PAUSED' ? (
        <ActionDialog
          trigger={t('platform.tontines.resume')}
          title={t('platform.tontines.resumeTitle', { name: x.name })}
          reason={{ label: t('platform.tontines.reason'), required: true }}
          confirmLabel={t('platform.tontines.resume')}
          successMessage={t('platform.tontines.resumed')}
          onConfirm={async (reason) => {
            await api.post(`/admin/tontines/${x.id}/resume`, { reason });
            await onDone();
          }}
        />
      ) : null}
    </div>
  );
}

/** Tontines de la plateforme (super-admin) : recherche, filtre, pause, reprise, clôture. */
export default function AdminTontinesPage() {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const query = useQuery({
    queryKey: ['admin', 'tontines'],
    queryFn: () => api.get<ListResponse<TontineView>>('/admin/tontines'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'tontines'] });
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return (query.data?.data ?? []).filter(
      (x) => (!status || x.status === status) && (!q || x.name.toLocaleLowerCase().includes(q)),
    );
  }, [query.data, search, status]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h1">{t('platform.tontines.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('platform.tontines.description')}</p>
      </div>
      <div role="search" className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tontines-search">{t('platform.tontines.search')}</Label>
          <Input
            id="tontines-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tontines-status">{t('platform.tontines.status')}</Label>
          <Select id="tontines-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('platform.tontines.all')}</option>
            {TONTINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labels.tontineStatus[s] ?? s}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <QueryState query={query}>
        {() => (
          <Card>
            <CardContent className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {t('platform.tontines.count', { count: rows.length })}
              </p>
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t('platform.tontines.empty')}
                </p>
              ) : (
                <>
                  <ul className="divide-y rounded-md border md:hidden">
                    {rows.map((x) => (
                      <li key={x.id} className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium">{x.name}</p>
                          <StatusBadge status={x.status} labels={labels.tontineStatus} />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          <Amount value={x.contribution} /> · {x.memberCount}/{x.maxMembers}
                        </p>
                        <TontineActions x={x} onDone={refresh} />
                      </li>
                    ))}
                  </ul>
                  <Table className="hidden md:table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('platform.tontines.colName')}</TableHead>
                        <TableHead>{t('platform.tontines.colContribution')}</TableHead>
                        <TableHead>{t('platform.tontines.colMembers')}</TableHead>
                        <TableHead>{t('platform.tontines.colCycle')}</TableHead>
                        <TableHead>{t('platform.tontines.colStart')}</TableHead>
                        <TableHead>{t('platform.tontines.colStatus')}</TableHead>
                        <TableHead>
                          <span className="sr-only">{t('platform.tontines.actions')}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((x) => (
                        <TableRow key={x.id}>
                          <TableCell className="font-medium">{x.name}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Amount value={x.contribution} /> ·{' '}
                            {labels.frequency[x.frequency] ?? x.frequency}
                          </TableCell>
                          <TableCell>
                            {x.memberCount}/{x.maxMembers}
                          </TableCell>
                          <TableCell>
                            {x.currentCycleNumber
                              ? `${x.currentCycleNumber}/${x.totalCycles ?? '?'}`
                              : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{f.date(x.startDate)}</TableCell>
                          <TableCell>
                            <StatusBadge status={x.status} labels={labels.tontineStatus} />
                          </TableCell>
                          <TableCell>
                            <TontineActions x={x} onDone={refresh} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
