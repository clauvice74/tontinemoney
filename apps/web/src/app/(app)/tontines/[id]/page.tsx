'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tontine/ui';
import { Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { PayDialog } from '@/components/tontines/pay-dialog';
import { TontineSummary } from '@/components/tontines/tontine-summary';
import { api } from '@/lib/api';
import type {
  ListResponse,
  MemberTontineDashboard,
  ParticipantView,
  PriorityRequestView,
  TontineView,
} from '@/lib/api/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { CONTRIBUTION_STATUS_LABELS, TONTINE_STATUS_LABELS } from '@/lib/labels';
import { formatMoneyView } from '@/lib/money';
import { useTontine } from '@/lib/queries';

function Participants({ tontineId }: { tontineId: string }) {
  const query = useQuery({
    queryKey: ['tontines', tontineId, 'participants'],
    queryFn: () =>
      api.get<ListResponse<ParticipantView> | ParticipantView[]>(
        `/tontines/${tontineId}/participants`,
      ),
    select: (d) => (Array.isArray(d) ? d : d.data),
  });
  return (
    <QueryState
      query={query}
      isEmpty={(d) => d.length === 0}
      empty={<p className="text-sm text-muted-foreground">Aucun participant.</p>}
    >
      {(list) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ordre</TableHead>
              <TableHead>Prénom</TableHead>
              <TableHead>Cotisation du cycle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => (
              <TableRow key={p.memberId}>
                <TableCell className="tabular-nums">{p.position ?? '—'}</TableCell>
                <TableCell className="font-medium">
                  {p.firstName}
                  {p.role === 'ADMIN' ? (
                    <Badge variant="secondary" className="ml-2">
                      Admin
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={p.currentContributionStatus}
                    labels={CONTRIBUTION_STATUS_LABELS}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </QueryState>
  );
}

function MyContributions({ tontine }: { tontine: TontineView }) {
  const query = useQuery({
    queryKey: ['tontines', tontine.id, 'dashboard', 'member'],
    queryFn: () => api.get<MemberTontineDashboard>(`/tontines/${tontine.id}/dashboard`),
  });
  return (
    <QueryState query={query} comingSoonTitle="Échéancier bientôt disponible">
      {(d) => (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <p>
              Pénalités dues : <Money value={d.myPenaltyBalance} className="font-semibold" />
            </p>
            {d.myBeneficiaryCycles.length > 0 ? (
              <p>
                Mon tour : cycle{d.myBeneficiaryCycles.length > 1 ? 's' : ''}{' '}
                {d.myBeneficiaryCycles
                  .map((c) => `${c.number}${c.dueDate ? ` (${formatDate(c.dueDate)})` : ''}`)
                  .join(', ')}
              </p>
            ) : null}
          </div>
          {d.myContributions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune échéance.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.myContributions.map((c) => {
                  const payable =
                    c.status === 'PENDING' || c.status === 'LATE' || c.status === 'DEFAULTED';
                  return (
                    <TableRow key={c.id}>
                      <TableCell>{c.cycleNumber ?? '—'}</TableCell>
                      <TableCell>{formatDate(c.dueDate)}</TableCell>
                      <TableCell>
                        <Money value={c.amount} />
                        {c.penalty && c.penalty.amountMinor !== '0' ? (
                          <span className="block text-xs text-destructive">
                            + pénalité {formatMoneyView(c.penalty)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} labels={CONTRIBUTION_STATUS_LABELS} />
                      </TableCell>
                      <TableCell className="text-right">
                        {payable ? (
                          <PayDialog
                            label="Cotiser"
                            path={`/tontines/${tontine.id}/contributions/${c.id}/pay`}
                            successMessage="Cotisation payée"
                            summary={
                              <>
                                Cotisation du cycle {c.cycleNumber ?? ''} de « {tontine.name} » :{' '}
                                <Money value={c.amount} className="font-semibold" />
                                {c.penalty && c.penalty.amountMinor !== '0' ? (
                                  <> + pénalité {formatMoneyView(c.penalty)}</>
                                ) : null}
                              </>
                            }
                          />
                        ) : c.paidAt ? (
                          <span className="text-xs text-muted-foreground">
                            Payée le {formatDate(c.paidAt)}
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </QueryState>
  );
}

function PriorityRequests({ tontineId }: { tontineId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['tontines', tontineId, 'priority-requests'],
    queryFn: () =>
      api.get<ListResponse<PriorityRequestView>>(`/tontines/${tontineId}/priority-requests`),
  });
  return (
    <div className="space-y-3">
      <ActionDialog
        trigger="Faire une demande prioritaire"
        triggerVariant="default"
        title="Demande de passage prioritaire"
        description="Expliquez votre besoin : l’administrateur désignera le bénéficiaire du prochain cycle."
        reason={{ label: 'Motif', required: true, minLength: 10 }}
        confirmLabel="Envoyer"
        successMessage="Demande envoyée"
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
        empty={<p className="text-sm text-muted-foreground">Aucune demande.</p>}
      >
        {(d) => (
          <ul className="space-y-2 text-sm">
            {d.data.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <p className="font-medium">
                  {r.firstName ?? 'Membre'} · {formatDateTime(r.createdAt)}
                </p>
                <p className="text-muted-foreground">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

export default function TontineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tontine = useTontine(id);
  return (
    <QueryState
      query={tontine}
      comingSoonTitle="Tontine introuvable ou fonctionnalité bientôt disponible"
    >
      {(t) => (
        <div className="space-y-6">
          <PageHeader
            title={t.name}
            description={<StatusBadge status={t.status} labels={TONTINE_STATUS_LABELS} />}
            actions={
              <>
                {t.entryFee && t.entryFee.amountMinor !== '0' && t.myStatus !== 'ACTIVE' ? (
                  <PayDialog
                    label="Payer le droit d’entrée"
                    path={`/tontines/${t.id}/entry-fee/pay`}
                    successMessage="Droit d’entrée payé"
                    size="default"
                    summary={
                      <>
                        Droit d’entrée de « {t.name} » :{' '}
                        <Money value={t.entryFee} className="font-semibold" />
                      </>
                    }
                  />
                ) : null}
                {t.myRole === 'ADMIN' ? (
                  <Button asChild variant="outline">
                    <Link href={`/tontines/${t.id}/admin`}>
                      <Settings aria-hidden="true" /> Gérer la tontine
                    </Link>
                  </Button>
                ) : null}
              </>
            }
          />
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <TontineSummary tontine={t} />
            </CardContent>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Mes échéances</CardTitle>
              </CardHeader>
              <CardContent>
                <MyContributions tontine={t} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Participants</CardTitle>
                <CardDescription>
                  Prénoms et statut de cotisation du cycle en cours.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Participants tontineId={t.id} />
              </CardContent>
            </Card>
          </div>
          {t.drawMode === 'PRIORITY_NEED' ? (
            <Card>
              <CardHeader>
                <CardTitle>Besoin prioritaire</CardTitle>
              </CardHeader>
              <CardContent>
                <PriorityRequests tontineId={t.id} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </QueryState>
  );
}
