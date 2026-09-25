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
  hash?: string;
  algorithm?: string;
  createdAt?: string;
  seed?: string;
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
    enabled: tontine.data?.drawMode === 'RANDOM',
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
            <p className="break-all font-mono">{proof.data.hash ?? '—'}</p>
            <p className="text-muted-foreground">
              {proof.data.algorithm ?? 'SHA-256'} · {formatDateTime(proof.data.createdAt)}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
