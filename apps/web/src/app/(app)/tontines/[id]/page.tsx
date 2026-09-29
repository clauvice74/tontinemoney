'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingBlock,
  ProgressBar,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Timeline,
  type TimelineItem,
} from '@tontine/ui';
import { ArrowLeft, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ActionDialog } from '@/components/action-dialog';
import { ErrorAlert, QueryState } from '@/components/feedback';
import { Amount } from '@/components/amount';
import { StatusBadge } from '@/components/status-badge';
import { InviteDialog } from '@/components/tontines/invite-dialog';
import { PayDialog } from '@/components/tontines/pay-dialog';
import { api } from '@/lib/api';
import type {
  ListResponse,
  MoneyView,
  ParticipantView,
  PriorityRequestView,
  TontineView,
} from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { PAYABLE_STATUSES, useCurrentUser, useMyContributions, useTontine } from '@/lib/queries';

interface CycleRow {
  id: string;
  number: number;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  beneficiary: { memberId: string; firstName: string } | null;
  expected: MoneyView;
  collected: MoneyView;
  payout: MoneyView | null;
  partialPayout: boolean;
  paidCount: number;
  memberCount: number;
  completedAt: string | null;
}

const CLOSED = ['COMPLETED', 'CANCELLED'];

function useCycles(tontineId: string) {
  return useQuery({
    queryKey: ['tontines', tontineId, 'cycles'],
    queryFn: () => api.get<ListResponse<CycleRow>>(`/tontines/${tontineId}/cycles`),
  });
}

function useParticipants(tontineId: string) {
  return useQuery({
    queryKey: ['tontines', tontineId, 'participants'],
    queryFn: () =>
      api.get<ListResponse<ParticipantView> | ParticipantView[]>(
        `/tontines/${tontineId}/participants`,
      ),
    select: (d) => (Array.isArray(d) ? d : d.data),
  });
}

function hasAmount(m: MoneyView | null | undefined): m is MoneyView {
  return !!m && m.amountMinor !== '0';
}

/** Fréquence lisible dans la langue courante (jour, semaine du mois, dernier jour). */
function useFrequencyText() {
  const { t } = useI18n();
  const labels = useLabels();
  return (x: Pick<TontineView, 'frequency' | 'frequencyDetail'>) => {
    const base = labels.frequency[x.frequency] ?? x.frequency;
    const d = x.frequencyDetail ?? {};
    const day = typeof d.day === 'string' ? labels.weekday[d.day] : undefined;
    if (x.frequency === 'MONTHLY' && d.lastDayOfMonth) return `${base} — ${t('wizard.lastDay')}`;
    if (day && d.weekOfMonth !== undefined) {
      return `${base} — ${day}, ${labels.weekOfMonth[String(d.weekOfMonth)] ?? ''}`;
    }
    return day ? `${base} — ${day}` : base;
  };
}

/** Progression : cycles écoulés, cycle en cours (échéance, bénéficiaire, contributions reçues). */
function ProgressCard({ tontine }: { tontine: TontineView }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const total = tontine.totalCycles ?? tontine.maxMembers;
  const done =
    tontine.status === 'COMPLETED' ? total : Math.max((tontine.currentCycleNumber ?? 1) - 1, 0);
  const cur = tontine.currentCycle;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tontine.progressTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ProgressBar
          value={done}
          max={total}
          label={t('tontines.progress')}
          valueText={
            tontine.currentCycleNumber
              ? t('tontines.cycleOf', { current: tontine.currentCycleNumber, total })
              : t('tontines.notStarted', { date: f.date(tontine.startDate) })
          }
          showLabel
        />
        {cur ? (
          <div className="space-y-3 rounded-md bg-muted p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {t('tontine.currentCycle')} · {cur.number}
              </p>
              <StatusBadge status={cur.status} labels={labels.cycleStatus} />
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p>
                <span className="block text-xs text-muted-foreground">
                  {t('tontines.nextBeneficiary')}
                </span>
                <span className="font-medium">
                  {cur.beneficiary?.firstName ?? t('tontines.none')}
                </span>
              </p>
              <p>
                <span className="block text-xs text-muted-foreground">{t('tontine.due')}</span>
                <span className="font-medium">{f.date(cur.dueDate)}</span>
              </p>
            </div>
            <ProgressBar
              value={cur.paidCount}
              max={Math.max(cur.memberCount, 1)}
              label={t('tontine.currentContribution')}
              valueText={t('tontine.collectedOf', { paid: cur.paidCount, total: cur.memberCount })}
              showLabel
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Informations générales (configuration). */
function InfoCard({ tontine: x }: { tontine: TontineView }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const freq = useFrequencyText();
  const p = x.penaltyRules ?? {};
  const rows: Array<[string, React.ReactNode]> = [
    [t('tontine.contribution'), <Amount key="c" value={x.contribution} />],
    [t('tontine.frequency'), freq(x)],
    [t('tontine.startDate'), f.date(x.startDate)],
    [t('tontine.members'), `${x.memberCount} / ${x.maxMembers}`],
    [t('tontine.drawMode'), labels.drawMode[x.drawMode] ?? x.drawMode],
    [
      t('tontine.penalties'),
      t('tontine.penaltiesValue', { percent: p.lateFeePercent ?? 0, days: p.graceDays ?? 0 }),
    ],
    [t('tontine.entryFee'), hasAmount(x.entryFee) ? <Amount key="e" value={x.entryFee} /> : '—'],
    [t('tontine.collation'), hasAmount(x.collation) ? <Amount key="k" value={x.collation} /> : '—'],
    [
      t('tontine.incompletePolicy'),
      labels.incompletePolicy[x.incompletePolicy] ?? x.incompletePolicy,
    ],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tontine.infoTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Chronologie des cycles : terminés, en cours, à venir. */
function CyclesTab({ tontine }: { tontine: TontineView }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const cycles = useCycles(tontine.id);
  const participants = useParticipants(tontine.id);
  return (
    <QueryState
      query={cycles}
      isEmpty={(d) => d.data.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t('tontine.cyclesEmpty')}</p>}
    >
      {(d) => {
        const items: TimelineItem[] = d.data.map((c) => ({
          id: c.id,
          status:
            c.status === 'COMPLETED' ? 'done' : c.status === 'PENDING' ? 'upcoming' : 'current',
          title: c.beneficiary
            ? t('tontine.cycleTitle', { number: c.number, name: c.beneficiary.firstName })
            : t('tontine.cycleTitleNoName', { number: c.number }),
          meta: t('tontine.dueOn', { date: f.date(c.dueDate) }),
          description: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} labels={labels.cycleStatus} />
              {c.status === 'PENDING' ? null : (
                <span>{t('tontine.collectedOf', { paid: c.paidCount, total: c.memberCount })}</span>
              )}
            </span>
          ),
        }));
        // Cycles pas encore ouverts : bénéficiaire prévu selon l'ordre de passage (si connu).
        const total = tontine.totalCycles ?? 0;
        const last = d.data.reduce((m, c) => Math.max(m, c.number), 0);
        for (let n = last + 1; n <= total; n += 1) {
          const who = participants.data?.find((p) => p.position === n)?.firstName;
          items.push({
            id: `upcoming-${n}`,
            status: 'upcoming',
            title: who
              ? t('tontine.cycleTitle', { number: n, name: who })
              : t('tontine.cycleTitleNoName', { number: n }),
          });
        }
        return (
          <Timeline
            items={items}
            statusLabels={{
              done: labels.cycleStatus.COMPLETED,
              current: labels.cycleStatus.IN_PROGRESS,
              upcoming: labels.cycleStatus.PENDING,
            }}
          />
        );
      }}
    </QueryState>
  );
}

function MembersTab({ tontineId }: { tontineId: string }) {
  const { t } = useI18n();
  const labels = useLabels();
  const query = useParticipants(tontineId);
  return (
    <QueryState
      query={query}
      isEmpty={(d) => d.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t('tontine.membersEmpty')}</p>}
    >
      {(list) => (
        <ul className="divide-y rounded-md border">
          {list.map((p) => (
            <li key={p.memberId} className="flex items-center gap-3 p-3">
              <Avatar name={p.firstName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.firstName}
                  {p.role === 'ADMIN' ? <Badge variant="info">{t('tontines.admin')}</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('tontine.position')} {p.position ?? '—'}
                </p>
              </div>
              {p.currentContributionStatus ? (
                <StatusBadge
                  status={p.currentContributionStatus}
                  labels={labels.contributionStatus}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

/** Mes contributions : échéancier, pénalités, paiement (solde affiché avant confirmation). */
function ContributionsTab({ tontine }: { tontine: TontineView }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const user = useCurrentUser();
  const mine = useMyContributions();
  const cycles = useCycles(tontine.id);
  const list = mine.contributions.filter((c) => c.tontineId === tontine.id);
  const penaltyMinor = list
    .filter((c) => c.penalty && !c.penaltyPaid)
    .reduce((sum, c) => sum + BigInt(c.penalty?.amountMinor ?? '0'), 0n);
  const myTurns = (cycles.data?.data ?? []).filter((c) => c.beneficiary?.memberId === user?.id);
  if (mine.isPending) return <LoadingBlock />;
  if (mine.isError) return <ErrorAlert error={mine.error} onRetry={() => void mine.refetch()} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <p>
          {t('tontine.penaltyBalance')} :{' '}
          <Amount
            value={{
              amount: '',
              amountMinor: penaltyMinor.toString(),
              currency: tontine.contribution.currency,
            }}
          />
        </p>
        {myTurns.length > 0 ? (
          <p className="font-medium">
            {t('tontine.myTurns', {
              cycles: myTurns
                .map((c) => `${c.number}${c.dueDate ? ` (${f.date(c.dueDate)})` : ''}`)
                .join(', '),
            })}
          </p>
        ) : null}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tontine.contributionsEmpty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.map((c) => {
            const processing = c.paymentStatus === 'PROCESSING';
            const payable =
              !processing && (PAYABLE_STATUSES as readonly string[]).includes(c.status);
            const total = c.totalDue ?? c.amount;
            return (
              <li
                key={c.id}
                className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t('tontine.cycleTitleNoName', { number: c.cycleNumber ?? '—' })} ·{' '}
                    <span className="font-normal text-muted-foreground">
                      {t('tontine.dueOn', { date: f.date(c.dueDate) })}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Amount value={c.amount} />
                    {hasAmount(c.penalty) ? (
                      <span className="text-xs text-destructive">
                        + {t('tontine.penaltyLabel')}{' '}
                        <Amount value={c.penalty} className="text-xs" />
                      </span>
                    ) : null}
                    <StatusBadge status={c.status} labels={labels.contributionStatus} />
                  </div>
                  {c.paymentError && payable ? (
                    <p className="text-xs text-destructive">
                      {t('tontine.lastError', { reason: c.paymentError })}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0">
                  {processing ? (
                    <span className="text-xs text-muted-foreground" role="status">
                      {t('dashboard.processing')}
                    </span>
                  ) : payable ? (
                    <PayDialog
                      label={t('dashboard.payCta')}
                      path={`/tontines/${tontine.id}/contributions/${c.id}/pay`}
                      amount={total}
                      successMessage={t('tontine.paySuccess')}
                      summary={t('tontine.paySummary', {
                        cycle: c.cycleNumber ?? '',
                        name: tontine.name,
                      })}
                    />
                  ) : c.paidAt ? (
                    <span className="text-xs text-muted-foreground">
                      {t('tontine.paidOn', { date: f.date(c.paidAt) })}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Bénéficiaires : versements effectués et ordre de passage à venir. */
function BeneficiariesTab({ tontineId }: { tontineId: string }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const cycles = useCycles(tontineId);
  return (
    <QueryState
      query={cycles}
      isEmpty={(d) => d.data.every((c) => !c.beneficiary)}
      empty={<p className="text-sm text-muted-foreground">{t('tontine.beneficiariesEmpty')}</p>}
    >
      {(d) => (
        <ul className="divide-y rounded-md border">
          {d.data
            .filter((c) => c.beneficiary)
            .map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <Avatar name={c.beneficiary!.firstName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.beneficiary!.firstName}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('tontine.cycleTitleNoName', { number: c.number })} ·{' '}
                    {c.completedAt
                      ? t('tontine.received', { date: f.date(c.completedAt) })
                      : t('tontine.dueOn', { date: f.date(c.dueDate) })}
                  </p>
                </div>
                {c.payout ? (
                  <Amount value={c.payout} signed="in" />
                ) : (
                  <StatusBadge status={c.status} labels={labels.cycleStatus} />
                )}
              </li>
            ))}
        </ul>
      )}
    </QueryState>
  );
}

function PriorityRequests({ tontineId }: { tontineId: string }) {
  const { t } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['tontines', tontineId, 'priority-requests'],
    queryFn: () =>
      api.get<ListResponse<PriorityRequestView>>(`/tontines/${tontineId}/priority-requests`),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tontine.priorityTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ActionDialog
          trigger={t('tontine.priorityCta')}
          triggerVariant="outline"
          title={t('tontine.priorityDialogTitle')}
          description={t('tontine.priorityDialogBody')}
          reason={{ label: t('tontine.priorityReason'), required: true, minLength: 10 }}
          confirmLabel={t('tontine.prioritySend')}
          successMessage={t('tontine.prioritySent')}
          onConfirm={async (reason) => {
            await api.post(`/tontines/${tontineId}/priority-requests`, { reason });
            await queryClient.invalidateQueries({
              queryKey: ['tontines', tontineId, 'priority-requests'],
            });
          }}
        />
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={<p className="text-sm text-muted-foreground">{t('tontine.priorityEmpty')}</p>}
        >
          {(d) => (
            <ul className="space-y-2 text-sm">
              {d.data.map((r) => (
                <li key={r.id} className="rounded-md border p-3">
                  <p className="font-medium">
                    {r.firstName ?? '—'} · {f.dateTime(r.createdAt)}
                  </p>
                  <p className="text-muted-foreground">{r.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** Détail d'une tontine : en-tête, progression, informations, cycles, membres, contributions. */
export default function TontineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tontine = useTontine(id);
  const { t } = useI18n();
  const labels = useLabels();
  return (
    <QueryState query={tontine} comingSoonTitle={t('tontine.notFound')}>
      {(x) => {
        const isAdmin = x.myRole === 'ADMIN';
        const canInvite = isAdmin && !CLOSED.includes(x.status) && x.memberCount < x.maxMembers;
        return (
          <div className="space-y-6">
            <Link
              href="/tontines"
              className="inline-flex items-center gap-1 text-sm text-info underline-offset-4 hover:underline"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> {t('tontines.title')}
            </Link>
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <h1 className="text-h1">{x.name}</h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <StatusBadge status={x.status} labels={labels.tontineStatus} />
                  {isAdmin ? <Badge variant="info">{t('tontines.admin')}</Badge> : null}
                  <span>
                    <Amount value={x.contribution} /> · {labels.frequency[x.frequency]}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {canInvite ? <InviteDialog tontineId={x.id} /> : null}
                {hasAmount(x.entryFee) && x.myStatus !== 'ACTIVE' ? (
                  <PayDialog
                    label={t('tontine.payEntryFee')}
                    path={`/tontines/${x.id}/entry-fee/pay`}
                    amount={x.entryFee}
                    successMessage={t('tontine.entryFeePaid')}
                    size="md"
                    variant={isAdmin ? 'secondary' : 'primary'}
                    summary={t('tontine.entryFeeSummary', { name: x.name })}
                  />
                ) : null}
                {isAdmin ? (
                  <Button asChild variant="outline">
                    <Link href={`/tontines/${x.id}/admin`}>
                      <Settings aria-hidden="true" /> {t('tontine.manage')}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </header>

            <div className="grid gap-6 lg:grid-cols-2">
              <ProgressCard tontine={x} />
              <InfoCard tontine={x} />
            </div>

            <Card>
              <CardContent className="pt-5">
                <Tabs defaultValue="cycles">
                  <TabsList className="w-full justify-start sm:w-auto">
                    <TabsTrigger value="cycles">{t('tontine.tabs.cycles')}</TabsTrigger>
                    <TabsTrigger value="members">{t('tontine.tabs.members')}</TabsTrigger>
                    <TabsTrigger value="contributions">
                      {t('tontine.tabs.contributions')}
                    </TabsTrigger>
                    <TabsTrigger value="beneficiaries">
                      {t('tontine.tabs.beneficiaries')}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="cycles">
                    <CyclesTab tontine={x} />
                  </TabsContent>
                  <TabsContent value="members">
                    <MembersTab tontineId={x.id} />
                  </TabsContent>
                  <TabsContent value="contributions">
                    <ContributionsTab tontine={x} />
                  </TabsContent>
                  <TabsContent value="beneficiaries">
                    <BeneficiariesTab tontineId={x.id} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {x.drawMode === 'PRIORITY_NEED' ? <PriorityRequests tontineId={x.id} /> : null}
          </div>
        );
      }}
    </QueryState>
  );
}
