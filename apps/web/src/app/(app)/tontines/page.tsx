'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from '@tontine/ui';
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { QueryState } from '@/components/feedback';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { InvitationView, ListResponse } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { formatError } from '@/lib/forms';
import {
  FREQUENCY_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  TONTINE_STATUS_LABELS,
  label,
} from '@/lib/labels';
import { qk, useMyTontines } from '@/lib/queries';

function ReceivedInvitations() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['me', 'invitations'],
    queryFn: () => api.get<ListResponse<InvitationView>>('/me/invitations'),
  });
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      api.post(`/invitations/${id}/respond`, { accept }),
    onSuccess: async (_r, v) => {
      toast.success(v.accept ? 'Invitation acceptée' : 'Invitation refusée');
      await queryClient.invalidateQueries({ queryKey: ['me', 'invitations'] });
      await queryClient.invalidateQueries({ queryKey: qk.tontines });
    },
    onError: (e) => {
      const reasons =
        e instanceof ApiError && Array.isArray(e.body.reasons)
          ? (e.body.reasons as unknown[]).map(String).join(' · ')
          : undefined;
      toast.error(
        reasons ? 'Vous n’êtes pas encore éligible' : 'Action impossible',
        reasons ?? formatError(e),
      );
    },
  });

  return (
    <QueryState
      query={query}
      comingSoonTitle="Invitations bientôt disponibles"
      isEmpty={(d) => d.data.filter((i) => i.status === 'PENDING').length === 0}
      empty={<p className="text-sm text-muted-foreground">Aucune invitation en attente.</p>}
    >
      {(d) => (
        <ul className="divide-y">
          {d.data
            .filter((i) => i.status === 'PENDING')
            .map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{i.tontine?.name ?? 'Tontine'}</p>
                  <p className="text-sm text-muted-foreground">
                    {i.tontine?.contribution ? <Money value={i.tontine.contribution} /> : null}
                    {i.tontine?.frequency
                      ? ` · ${label(FREQUENCY_LABELS, i.tontine.frequency)}`
                      : ''}
                    {i.tontine?.startDate ? ` · début ${formatDate(i.tontine.startDate)}` : ''}
                    {` · expire le ${formatDate(i.expiresAt)}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => respond.mutate({ id: i.id, accept: true })}
                    disabled={respond.isPending}
                  >
                    Accepter
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => respond.mutate({ id: i.id, accept: false })}
                    disabled={respond.isPending}
                  >
                    Refuser
                  </Button>
                </div>
              </li>
            ))}
        </ul>
      )}
    </QueryState>
  );
}

export default function TontinesPage() {
  const tontines = useMyTontines();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes tontines"
        description="Tontines auxquelles vous participez ou que vous administrez."
        actions={
          <Button asChild>
            <Link href="/tontines/new">
              <Plus aria-hidden="true" /> Créer une tontine
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Invitations reçues</CardTitle>
        </CardHeader>
        <CardContent>
          <ReceivedInvitations />
        </CardContent>
      </Card>
      <QueryState
        query={tontines}
        comingSoonTitle="Tontines bientôt disponibles"
        isEmpty={(d) => d.data.length === 0}
        empty={
          <Alert variant="info" title="Aucune tontine pour le moment">
            Acceptez une invitation ou créez votre propre tontine (vérification d’identité de niveau
            3 requise).
          </Alert>
        }
      >
        {(d) => (
          <ul className="grid gap-4 md:grid-cols-2">
            {d.data.map((t) => (
              <li key={t.id}>
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>
                        <Link href={`/tontines/${t.id}`} className="hover:underline">
                          {t.name}
                        </Link>
                      </CardTitle>
                      <StatusBadge status={t.status} labels={TONTINE_STATUS_LABELS} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>
                      <Money value={t.contribution} className="font-medium" /> ·{' '}
                      {label(FREQUENCY_LABELS, t.frequency)}
                    </p>
                    <p className="flex items-center gap-1 text-muted-foreground">
                      <Users className="size-4" aria-hidden="true" /> {t.memberCount}/{t.maxMembers}{' '}
                      membres
                      {t.currentCycleNumber
                        ? ` · cycle ${t.currentCycleNumber}/${t.totalCycles ?? '?'}`
                        : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {t.myRole === 'ADMIN' ? (
                        <Badge variant="secondary">Administrateur</Badge>
                      ) : null}
                      {t.myStatus && t.myStatus !== 'ACTIVE' ? (
                        <StatusBadge status={t.myStatus} labels={MEMBERSHIP_STATUS_LABELS} />
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/tontines/${t.id}`}>Détails</Link>
                      </Button>
                      {t.myRole === 'ADMIN' ? (
                        <Button size="sm" asChild>
                          <Link href={`/tontines/${t.id}/admin`}>Gérer</Link>
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
