'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  ProgressBar,
  toast,
} from '@tontine/ui';
import { Mail, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { Amount } from '@/components/amount';
import { QueryState } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { InvitationView, ListResponse, TontineView } from '@/lib/api/types';
import { formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { qk, useMyTontines } from '@/lib/queries';

/** Invitations reçues en attente : statut et conditions visibles avant d'accepter. */
function ReceivedInvitations() {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['me', 'invitations'],
    queryFn: () => api.get<ListResponse<InvitationView>>('/me/invitations'),
  });
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      api.post(`/invitations/${id}/respond`, { accept }),
    onSuccess: async (_r, v) => {
      toast.success(v.accept ? t('tontines.accepted') : t('tontines.declined'));
      await queryClient.invalidateQueries({ queryKey: ['me', 'invitations'] });
      await queryClient.invalidateQueries({ queryKey: qk.tontines });
    },
    onError: (e) => {
      const reasons =
        e instanceof ApiError && Array.isArray(e.body.reasons)
          ? (e.body.reasons as unknown[]).map(String).join(' · ')
          : undefined;
      toast.error(
        reasons ? t('tontines.notEligible') : t('tontines.actionFailed'),
        reasons ?? formatError(e),
      );
    },
  });
  const pending = query.data?.data.filter((i) => i.status === 'PENDING') ?? [];
  // Rien à afficher (ni chargement bruyant) quand il n'y a pas d'invitation en attente.
  if (query.isSuccess && pending.length === 0) return null;
  return (
    <section aria-labelledby="invitations-title" className="space-y-3">
      <h2 id="invitations-title" className="flex items-center gap-2 text-h3">
        <Mail className="size-4 text-info" aria-hidden="true" /> {t('tontines.invitationsTitle')}
      </h2>
      <QueryState query={query}>
        {() => (
          <ul className="grid gap-3 md:grid-cols-2">
            {pending.map((i) => (
              <li key={i.id}>
                <Card className="h-full border-info/40 bg-secondary">
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{i.tontine?.name ?? '—'}</p>
                      <Badge variant="new">{labels.invitationStatus.PENDING}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {i.tontine?.contribution ? <Amount value={i.tontine.contribution} /> : null}
                      {i.tontine?.frequency
                        ? ` · ${labels.frequency[i.tontine.frequency] ?? i.tontine.frequency}`
                        : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('tontines.expires', { date: f.date(i.expiresAt) })}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => respond.mutate({ id: i.id, accept: true })}
                        disabled={respond.isPending}
                      >
                        {t('tontines.accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respond.mutate({ id: i.id, accept: false })}
                        disabled={respond.isPending}
                      >
                        {t('tontines.decline')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

/** Carte tontine : nom, montant, membres, statut, progression, prochain bénéficiaire. */
function TontineCard({ tontine: x }: { tontine: TontineView }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const total = x.totalCycles ?? x.maxMembers;
  const done = x.status === 'COMPLETED' ? total : Math.max((x.currentCycleNumber ?? 1) - 1, 0);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{x.name}</CardTitle>
          <StatusBadge status={x.status} labels={labels.tontineStatus} />
        </div>
        <div className="flex flex-wrap gap-2">
          {x.myRole === 'ADMIN' ? <Badge variant="info">{t('tontines.admin')}</Badge> : null}
          {x.myStatus && x.myStatus !== 'ACTIVE' ? (
            <StatusBadge status={x.myStatus} labels={labels.membershipStatus} />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p>
            <Amount value={x.contribution} size="h3" />{' '}
            <span className="text-xs text-muted-foreground">
              {t('tontines.perTurn')} · {labels.frequency[x.frequency]}
            </span>
          </p>
          <p className="flex items-center gap-1 text-muted-foreground">
            <Users className="size-4" aria-hidden="true" />
            {t('tontines.members', { count: x.memberCount, max: x.maxMembers })}
          </p>
        </div>
        <ProgressBar
          value={done}
          max={total}
          label={t('tontines.progress')}
          valueText={
            x.currentCycleNumber
              ? t('tontines.cycleOf', { current: x.currentCycleNumber, total })
              : t('tontines.notStarted', { date: f.date(x.startDate) })
          }
          showLabel
        />
        {x.currentCycle ? (
          <p className="text-muted-foreground">
            {t('tontines.nextBeneficiary')} :{' '}
            <span className="font-medium text-foreground">
              {x.currentCycle.beneficiary?.firstName ?? t('tontines.none')}
            </span>
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" asChild>
          <Link href={`/tontines/${x.id}`} aria-label={`${t('tontines.seeDetails')} — ${x.name}`}>
            {t('tontines.seeDetails')}
          </Link>
        </Button>
        {x.myRole === 'ADMIN' ? (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`/tontines/${x.id}/admin`}
              aria-label={`${t('tontines.manage')} — ${x.name}`}
            >
              {t('tontines.manage')}
            </Link>
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export default function TontinesPage() {
  const { t } = useI18n();
  const tontines = useMyTontines();
  const create = (
    <Button asChild variant="primary">
      <Link href="/tontines/new">
        <Plus aria-hidden="true" /> {t('tontines.create')}
      </Link>
    </Button>
  );
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-h1">{t('tontines.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('tontines.description')}</p>
        </div>
        {create}
      </header>
      <ReceivedInvitations />
      <QueryState
        query={tontines}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <EmptyState
            icon={<Users aria-hidden="true" />}
            title={t('tontines.emptyTitle')}
            description={t('tontines.emptyBody')}
          />
        }
      >
        {(d) => (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.data.map((x) => (
              <li key={x.id}>
                <TontineCard tontine={x} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
