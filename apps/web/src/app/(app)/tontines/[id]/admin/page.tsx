'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
import { AlertCircle, CircleDollarSign, HandCoins, RefreshCw } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { Money } from '@/components/money';
import { StatCard } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { TontineSummary } from '@/components/tontines/tontine-summary';
import { api } from '@/lib/api';
import type { AdminTontineDashboard } from '@/lib/api/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatMoneyView } from '@/lib/money';
import { qk, useTontine } from '@/lib/queries';

/** Rafraîchissement automatique du tableau de bord (US-4.10). */
const REFRESH_MS = 30_000;

type Beneficiary = NonNullable<AdminTontineDashboard['currentCycle']>['beneficiary'];

function beneficiaryName(b: Beneficiary): string {
  if (!b) return 'À déterminer';
  if (typeof b === 'string') return b;
  return b.fullName ?? b.firstName ?? 'Membre';
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
  const check = useQuery({
    queryKey: ['tontines', id, 'start-check'],
    queryFn: () => api.get<{ blockers: string[] }>(`/tontines/${id}/start-check`),
  });
  const blockers = check.data?.blockers ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Démarrage</CardTitle>
        <CardDescription>
          La tontine démarre automatiquement à la date prévue si toutes les conditions sont réunies.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {blockers.length ? (
          <ul className="list-disc space-y-1 pl-5 text-destructive">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="text-success">Toutes les conditions sont réunies.</p>
        )}
        <ActionDialog
          trigger="Démarrer maintenant"
          disabled={blockers.length > 0}
          title="Démarrer la tontine ?"
          description="Le tirage (mode aléatoire) est effectué et le premier cycle est ouvert. Irréversible."
          confirmLabel="Démarrer"
          successMessage="Demande de démarrage traitée"
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

export default function TontineAdminDashboardPage() {
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
  const t = tontine.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          <RefreshCw className="size-3" aria-hidden="true" />
          Actualisation automatique toutes les 30 s
          {dashboard.dataUpdatedAt
            ? ` · mis à jour à ${new Date(dashboard.dataUpdatedAt).toLocaleTimeString('fr-FR')}`
            : ''}
        </p>
        {t && (t.status === 'DRAFT' || t.status === 'READY') ? (
          <ActionDialog
            trigger="Annuler la tontine"
            triggerVariant="destructive"
            title="Annuler la tontine"
            description="Possible uniquement avant le démarrage. Les membres seront notifiés."
            reason={{ label: 'Motif', required: true }}
            confirmVariant="destructive"
            confirmLabel="Annuler la tontine"
            successMessage="Tontine annulée"
            onConfirm={async (reason) => {
              await api.post(`/tontines/${id}/cancel`, { reason });
              await queryClient.invalidateQueries({ queryKey: qk.tontine(id) });
            }}
          />
        ) : null}
      </div>

      {t && (t.status === 'DRAFT' || t.status === 'READY') ? (
        <StartPanel
          id={id}
          onStarted={() => queryClient.invalidateQueries({ queryKey: ['tontines', id] })}
        />
      ) : null}

      <QueryState query={dashboard} comingSoonTitle="Tableau de bord bientôt disponible">
        {(d) => {
          const c = d.currentCycle;
          const progress =
            c && c.memberCount > 0 ? Math.round((c.paidCount / c.memberCount) * 100) : 0;
          return (
            <>
              <section
                aria-label="Indicateurs"
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
              >
                <StatCard
                  label="Total collecté"
                  value={formatMoneyView(d.totalCollected)}
                  icon={<CircleDollarSign />}
                />
                <StatCard
                  label="Pénalités perçues"
                  value={formatMoneyView(d.penaltiesCollected)}
                  icon={<HandCoins />}
                />
                <StatCard
                  label="Cycle en cours"
                  value={c ? `${c.number}${t?.totalCycles ? ` / ${t.totalCycles}` : ''}` : '—'}
                  hint={c ? `Échéance ${formatDate(c.dueDate)}` : 'Tontine non démarrée'}
                />
                <StatCard
                  label="Membres en retard"
                  value={String(d.lateMembers.length)}
                  icon={<AlertCircle />}
                />
              </section>
              {c ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Cycle {c.number}</CardTitle>
                    <CardDescription>
                      Bénéficiaire : {beneficiaryName(c.beneficiary)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>
                          {c.paidCount} cotisation{c.paidCount > 1 ? 's' : ''} sur {c.memberCount}
                        </span>
                        <span className="font-medium">{progress} %</span>
                      </div>
                      <div
                        className="h-2.5 rounded-full bg-muted"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                        aria-label="Cotisations reçues"
                      >
                        <div
                          className="h-2.5 rounded-full bg-primary"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-sm">
                      Collecté : <Money value={c.collected} className="font-semibold" /> · Reste :{' '}
                      <Money value={c.remaining} className="font-semibold" />
                    </p>
                  </CardContent>
                </Card>
              ) : null}
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Membres en retard</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {d.lateMembers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Aucun retard.</p>
                    ) : (
                      <ul className="divide-y text-sm">
                        {d.lateMembers.map((m) => (
                          <li key={m.memberId} className="flex justify-between py-2">
                            <span className="font-medium">
                              {m.fullName ?? m.firstName ?? 'Membre'}
                            </span>
                            {m.daysLate !== undefined ? (
                              <span className="text-destructive">{m.daysLate} j de retard</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Historique des cycles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {d.cycles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Aucun cycle.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Cycle</TableHead>
                            <TableHead>Échéance</TableHead>
                            <TableHead>Collecté</TableHead>
                            <TableHead>Statut</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.cycles.map((cy) => (
                            <TableRow key={cy.id}>
                              <TableCell>{cy.number}</TableCell>
                              <TableCell>{formatDate(cy.dueDate)}</TableCell>
                              <TableCell>
                                <Money value={cy.collected} />
                              </TableCell>
                              <TableCell>
                                <StatusBadge
                                  status={cy.status}
                                  labels={{
                                    PENDING: 'À venir',
                                    IN_PROGRESS: 'En cours',
                                    PAYOUT_PENDING: 'Versement en attente',
                                    COMPLETED: 'Terminé',
                                  }}
                                />
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

      {t ? (
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <TontineSummary tontine={t} />
          </CardContent>
        </Card>
      ) : null}

      {t?.drawMode === 'RANDOM' && proof.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Preuve du tirage</CardTitle>
            <CardDescription>
              Empreinte permettant à chacun de vérifier l’ordre tiré au sort.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="break-all font-mono">{proof.data.proof ?? '—'}</p>
            <p className="text-muted-foreground">
              {proof.data.algorithm ?? 'SHA-256'} · {formatDateTime(proof.data.drawnAt)} ·{' '}
              {proof.data.verified ? 'vérifiée ✔' : 'non vérifiable'}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              Graine : {proof.data.seed ?? '—'}
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
