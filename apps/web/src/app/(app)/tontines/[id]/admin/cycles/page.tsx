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
  FormField,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from '@tontine/ui';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { Money } from '@/components/money';
import { Section } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { CycleView, ListResponse, ParticipantView, PriorityRequestView } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { formatError } from '@/lib/forms';
import { CONTRIBUTION_STATUS_LABELS } from '@/lib/labels';
import { useTontine } from '@/lib/queries';

const CYCLE_LABELS: Record<string, string> = {
  PENDING: 'À venir',
  IN_PROGRESS: 'En cours',
  PAYOUT_PENDING: 'Versement en attente',
  COMPLETED: 'Terminé',
};

function DesignateBeneficiary({ tontineId, cycleId }: { tontineId: string; cycleId: string }) {
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState('');
  const [pending, setPending] = useState(false);
  const requests = useQuery({
    queryKey: ['tontines', tontineId, 'priority-requests'],
    queryFn: () => api.get<ListResponse<PriorityRequestView>>(`/tontines/${tontineId}/priority-requests`),
  });
  const participants = useQuery({
    queryKey: ['tontines', tontineId, 'participants'],
    queryFn: () => api.get<ListResponse<ParticipantView> | ParticipantView[]>(`/tontines/${tontineId}/participants`),
    select: (d) => (Array.isArray(d) ? d : d.data),
  });

  async function designate() {
    if (!memberId) return;
    setPending(true);
    try {
      await api.post(`/tontines/${tontineId}/cycles/${cycleId}/beneficiary`, { memberId });
      toast.success('Bénéficiaire désigné');
      await queryClient.invalidateQueries({ queryKey: ['tontines', tontineId, 'cycles'] });
    } catch (e) {
      toast.error('Désignation impossible', formatError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Désigner le bénéficiaire (besoin prioritaire)</p>
      {requests.data?.data.length ? (
        <ul className="space-y-1 text-sm">
          {requests.data.data.map((r) => (
            <li key={r.id}>
              <span className="font-medium">{r.firstName ?? 'Membre'}</span> :{' '}
              <span className="text-muted-foreground">{r.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Aucune demande prioritaire.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <FormField id="beneficiary" label="Membre" className="flex-1">
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Choisir…</option>
            {(participants.data ?? []).map((p) => (
              <option key={p.memberId} value={p.memberId}>
                {p.firstName}
              </option>
            ))}
          </Select>
        </FormField>
        <Button onClick={() => void designate()} disabled={!memberId} loading={pending}>
          Désigner
        </Button>
      </div>
    </div>
  );
}

function CycleDetail({ tontineId, cycleId, drawMode }: { tontineId: string; cycleId: string; drawMode?: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['tontines', tontineId, 'cycles', cycleId],
    queryFn: () => api.get<CycleView>(`/tontines/${tontineId}/cycles/${cycleId}`),
  });
  return (
    <QueryState query={query}>
      {(c) => {
        const contributions = c.contributions ?? [];
        const paid = contributions.filter((x) => x.status === 'PAID' || x.status === 'PAID_LATE').length;
        return (
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Cycle {c.number}</CardTitle>
                <CardDescription>
                  Échéance {formatDate(c.dueDate)} · {paid}/{contributions.length} payées · bénéficiaire :{' '}
                  {c.beneficiary?.fullName ?? c.beneficiary?.firstName ?? 'à déterminer'}
                </CardDescription>
              </div>
              {c.status !== 'COMPLETED' ? (
                <ActionDialog
                  trigger="Forcer un versement partiel"
                  triggerVariant="destructive"
                  title="Versement partiel au bénéficiaire"
                  description="Le bénéficiaire recevra uniquement les cotisations déjà collectées. Cette action est journalisée."
                  reason={{ label: 'Motif', required: true }}
                  confirmVariant="destructive"
                  confirmLabel="Verser"
                  successMessage="Versement partiel effectué"
                  onConfirm={async (reason) => {
                    await api.post(`/tontines/${tontineId}/cycles/${cycleId}/force-payout`, { reason });
                    await queryClient.invalidateQueries({ queryKey: ['tontines', tontineId, 'cycles'] });
                  }}
                />
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {drawMode === 'PRIORITY_NEED' && !c.beneficiary && c.status !== 'COMPLETED' ? (
                <DesignateBeneficiary tontineId={tontineId} cycleId={cycleId} />
              ) : null}
              {contributions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune cotisation.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Membre</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Montant</TableHead>
                      <TableHead>Pénalité</TableHead>
                      <TableHead>Payée le</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contributions.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium">{k.memberName ?? '—'}</TableCell>
                        <TableCell>
                          <StatusBadge status={k.status} labels={CONTRIBUTION_STATUS_LABELS} />
                        </TableCell>
                        <TableCell>
                          <Money value={k.amount} />
                        </TableCell>
                        <TableCell>{k.penalty ? <Money value={k.penalty} /> : '—'}</TableCell>
                        <TableCell>{formatDate(k.paidAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      }}
    </QueryState>
  );
}

export default function CyclesPage() {
  const { id } = useParams<{ id: string }>();
  const tontine = useTontine(id);
  const [selected, setSelected] = useState<string | null>(null);
  const cycles = useQuery({
    queryKey: ['tontines', id, 'cycles'],
    queryFn: () => api.get<ListResponse<CycleView>>(`/tontines/${id}/cycles`),
  });

  return (
    <Section title="Cycles & cotisations" description="Qui a payé, retards, pénalités et versements.">
      <QueryState
        query={cycles}
        comingSoonTitle="Suivi des cycles bientôt disponible"
        isEmpty={(d) => d.data.length === 0}
        empty={
          <Alert variant="info" title="Aucun cycle">
            Les cycles sont générés au démarrage de la tontine.
          </Alert>
        }
      >
        {(d) => {
          const current = selected ?? d.data.find((c) => c.status === 'IN_PROGRESS')?.id ?? d.data[0]?.id ?? null;
          return (
            <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
              <nav aria-label="Cycles">
                <ul className="space-y-1">
                  {d.data.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(c.id)}
                        aria-current={current === c.id ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          current === c.id ? 'bg-secondary font-medium' : 'hover:bg-muted',
                        )}
                      >
                        <span>
                          Cycle {c.number}
                          <span className="block text-xs text-muted-foreground">{formatDate(c.dueDate)}</span>
                        </span>
                        <StatusBadge status={c.status} labels={CYCLE_LABELS} />
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              {current ? <CycleDetail tontineId={id} cycleId={current} drawMode={tontine.data?.drawMode} /> : null}
            </div>
          );
        }}
      </QueryState>
    </Section>
  );
}
