'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  KpiCard,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tontine/ui';
import {
  AlertCircle,
  CalendarClock,
  CircleDollarSign,
  HandCoins,
  Pencil,
  RefreshCw,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ActionDialog } from '@/components/action-dialog';
import { Amount } from '@/components/amount';
import { QueryState } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { AdminTontineDashboard } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { formatMoneyView } from '@/lib/money';
import { qk, useTontine } from '@/lib/queries';
import { isEditable } from '@/lib/tontines';

/** Rafraîchissement automatique du tableau de bord (US-4.10). */
const REFRESH_MS = 30_000;

type Beneficiary = NonNullable<AdminTontineDashboard['currentCycle']>['beneficiary'];

function beneficiaryName(b: Beneficiary | undefined, fallback: string): string {
  if (!b) return fallback;
  if (typeof b === 'string') return b;
  return b.fullName ?? b.firstName ?? fallback;
}

interface DrawProof {
  proof: string | null;
  algorithm: string | null;
  drawnAt: string | null;
  seed: string | null;
  verified: boolean | null;
  order: Array<{ position: number; memberId: string; firstName: string }>;
}

/** US-4.3 — conditions de démarrage et démarrage manuel (dès la date de début atteinte). */
function StartPanel({ id, onStarted }: { id: string; onStarted: () => Promise<unknown> }) {
  const { t } = useI18n();
  const check = useQuery({
    queryKey: ['tontines', id, 'start-check'],
    queryFn: () => api.get<{ blockers: string[] }>(`/tontines/${id}/start-check`),
  });
  const blockers = check.data?.blockers ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('adminT.start.title')}</CardTitle>
        <CardDescription>{t('adminT.start.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {blockers.length ? (
          <Alert variant="warning" title={t('adminT.start.title')}>
            <ul className="list-disc space-y-1 pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <p className="text-success">{t('adminT.start.ready')}</p>
        )}
        <ActionDialog
          trigger={t('adminT.start.now')}
          triggerVariant="primary"
          triggerSize="md"
          disabled={blockers.length > 0}
          title={t('adminT.start.confirmTitle')}
          description={t('adminT.start.confirmBody')}
          confirmLabel={t('adminT.start.confirm')}
          confirmVariant="primary"
          successMessage={t('adminT.start.done')}
          onConfirm={async () => {
            const r = await api.post<{ started: boolean; blockers: string[] }>(
              `/tontines/${id}/start`,
            );
            if (!r.started) throw new Error(r.blockers.join(' ; '));
            await onStarted();
          }}
        />
      </CardContent>
    </Card>
  );
}

/** Tableau de bord de l'administrateur (US-4.10) : indicateurs, cycle en cours, retards, cycles. */
export default function TontineAdminDashboardPage() {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const tontine = useTontine(id);
  const dashboard = useQuery({
    queryKey: ['tontines', id, 'dashboard', 'admin'],
    queryFn: () => api.get<AdminTontineDashboard>(`/tontines/${id}/dashboard`),
    refetchInterval: REFRESH_MS,
  });
  const proof = useQuery({
    queryKey: ['tontines', id, 'draw-proof'],
    queryFn: () => api.get<DrawProof>(`/tontines/${id}/draw-proof`),
    enabled: tontine.data?.drawMode === 'RANDOM' && !!tontine.data?.startedAt,
  });
  const x = tontine.data;
  const beforeStart = !!x && (x.status === 'DRAFT' || x.status === 'READY');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          <RefreshCw className="size-3" aria-hidden="true" />
          {t('adminT.autoRefresh')}
          {dashboard.dataUpdatedAt
            ? ` · ${t('adminT.updatedAt', { time: f.dateTime(new Date(dashboard.dataUpdatedAt)) })}`
            : ''}
        </p>
        {beforeStart ? (
          <ActionDialog
            trigger={t('adminT.cancel.cta')}
            triggerVariant="destructive"
            title={t('adminT.cancel.cta')}
            description={t('adminT.cancel.body')}
            reason={{ label: t('adminT.cancel.reason'), required: true }}
            confirmVariant="destructive"
            confirmLabel={t('adminT.cancel.cta')}
            successMessage={t('adminT.cancel.done')}
            onConfirm={async (reason) => {
              await api.post(`/tontines/${id}/cancel`, { reason });
              await queryClient.invalidateQueries({ queryKey: qk.tontine(id) });
            }}
          />
        ) : null}
      </div>

      {beforeStart ? (
        <StartPanel
          id={id}
          onStarted={() => queryClient.invalidateQueries({ queryKey: ['tontines', id] })}
        />
      ) : null}

      <QueryState query={dashboard}>
        {(d) => {
          const c = d.currentCycle;
          return (
            <>
              <section
                aria-label={t('adminT.tabs.dashboard')}
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
              >
                <KpiCard
                  label={t('adminT.kpi.members')}
                  icon={<Users />}
                  value={x ? x.memberCount : '—'}
                  unit={x ? `/ ${x.maxMembers}` : undefined}
                  hint={x ? t('adminT.kpi.membersHint', { max: x.maxMembers }) : undefined}
                />
                <KpiCard
                  label={t('adminT.kpi.pot')}
                  icon={<CircleDollarSign />}
                  value={<Amount value={d.totalCollected} size="h2" />}
                  hint={
                    d.reserveBalance
                      ? t('adminT.kpi.potHint', { amount: formatMoneyView(d.reserveBalance) })
                      : undefined
                  }
                />
                <KpiCard
                  label={t('adminT.kpi.contributions')}
                  icon={<HandCoins />}
                  value={c ? c.paidCount : '—'}
                  unit={c ? `/ ${c.memberCount}` : undefined}
                  tone={c && c.paidCount === c.memberCount ? 'success' : 'default'}
                  hint={
                    c
                      ? t('adminT.kpi.contributionsHint', { amount: formatMoneyView(c.remaining) })
                      : t('adminT.kpi.notStarted')
                  }
                />
                <KpiCard
                  label={t('adminT.kpi.late')}
                  icon={<AlertCircle />}
                  value={d.lateMembers.length}
                  tone={d.lateMembers.length > 0 ? 'destructive' : 'success'}
                  hint={
                    d.penaltiesDue
                      ? t('adminT.kpi.lateHint', { amount: formatMoneyView(d.penaltiesDue) })
                      : undefined
                  }
                />
                <KpiCard
                  label={t('adminT.kpi.cycles')}
                  icon={<CalendarClock />}
                  value={c ? c.number : '—'}
                  unit={c && x?.totalCycles ? `/ ${x.totalCycles}` : undefined}
                  hint={
                    c
                      ? t('adminT.kpi.cyclesHint', { date: f.date(c.dueDate) })
                      : t('adminT.kpi.notStarted')
                  }
                />
              </section>

              {c ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('adminT.currentCycle', { number: c.number })}</CardTitle>
                    <CardDescription>
                      {t('adminT.beneficiary', {
                        name: beneficiaryName(c.beneficiary, t('adminT.toBeDesignated')),
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ProgressBar
                      value={c.paidCount}
                      max={Math.max(c.memberCount, 1)}
                      label={t('adminT.kpi.contributions')}
                      valueText={`${c.paidCount} / ${c.memberCount}`}
                      showLabel
                    />
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        {t('adminT.colCollected')} : <Amount value={c.collected} />
                      </span>
                      <span className="text-muted-foreground">
                        {t('adminT.kpi.contributionsHint', {
                          amount: formatMoneyView(c.remaining),
                        })}
                      </span>
                    </p>
                  </CardContent>
                </Card>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('adminT.lateTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {d.lateMembers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('adminT.noLate')}</p>
                    ) : (
                      <ul className="divide-y rounded-md border text-sm">
                        {d.lateMembers.map((m) => (
                          <li key={m.memberId} className="flex justify-between gap-2 p-3">
                            <span className="font-medium">{m.fullName ?? m.firstName ?? '—'}</span>
                            {m.daysLate !== undefined ? (
                              <span className="text-destructive">
                                {t('adminT.daysLate', { days: m.daysLate })}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('adminT.cyclesTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {d.cycles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('adminT.cyclesEmpty')}</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('adminT.colCycle')}</TableHead>
                            <TableHead>{t('adminT.colBeneficiary')}</TableHead>
                            <TableHead>{t('adminT.colDue')}</TableHead>
                            <TableHead className="text-right">{t('adminT.colCollected')}</TableHead>
                            <TableHead>{t('adminT.colStatus')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.cycles.map((cy) => (
                            <TableRow key={cy.id}>
                              <TableCell>{cy.number}</TableCell>
                              <TableCell>{beneficiaryName(cy.beneficiary, '—')}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {f.date(cy.dueDate)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Amount value={cy.collected} />
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={cy.status} labels={labels.cycleStatus} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          );
        }}
      </QueryState>

      {x ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{t('adminT.config.title')}</CardTitle>
              <CardDescription>{t('adminT.config.locked')}</CardDescription>
            </div>
            {isEditable(x) ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/tontines/${id}/admin/settings`}>
                  <Pencil aria-hidden="true" /> {t('adminT.config.edit')}
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  [t('tontine.contribution'), <Amount key="c" value={x.contribution} />],
                  [t('tontine.frequency'), labels.frequency[x.frequency] ?? x.frequency],
                  [t('tontine.startDate'), f.date(x.startDate)],
                  [t('tontine.members'), `${x.memberCount} / ${x.maxMembers}`],
                  [t('tontine.drawMode'), labels.drawMode[x.drawMode] ?? x.drawMode],
                  [
                    t('tontine.incompletePolicy'),
                    labels.incompletePolicy[x.incompletePolicy] ?? x.incompletePolicy,
                  ],
                ] as Array<[string, React.ReactNode]>
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {x?.drawMode === 'RANDOM' && proof.data ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('adminT.proof.title')}</CardTitle>
            <CardDescription>{t('adminT.proof.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="break-all font-mono text-mono">{proof.data.proof ?? '—'}</p>
            <p className="text-muted-foreground">
              {proof.data.algorithm ?? 'SHA-256'} · {f.dateTime(proof.data.drawnAt)} ·{' '}
              {proof.data.verified ? t('adminT.proof.verified') : t('adminT.proof.unverifiable')}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {t('adminT.proof.seed', { seed: proof.data.seed ?? '—' })}
            </p>
            <ol className="list-decimal pl-5">
              {proof.data.order.map((o) => (
                <li key={o.memberId}>{o.firstName}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
