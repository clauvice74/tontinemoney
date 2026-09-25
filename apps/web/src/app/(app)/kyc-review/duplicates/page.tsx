'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@tontine/ui';
import Link from 'next/link';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface DuplicateAlert {
  id: string;
  memberId: string;
  duplicateOfMemberId: string;
  requestId: string;
  similarityScore: number;
  status: string;
  createdAt: string;
}

/** US-3.4 — doublons biométriques : confirmer (fraude) ou écarter (personnes distinctes). */
export default function KycDuplicatesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['kyc', 'duplicates'],
    queryFn: () => api.get<{ data: DuplicateAlert[] }>('/kyc/duplicates'),
  });
  const resolve =
    (id: string, resolution: 'CONFIRMED' | 'DISMISSED') => async (comment: string) => {
      await api.post(`/kyc/duplicates/${id}/resolve`, { resolution, comment });
      await queryClient.invalidateQueries({ queryKey: ['kyc'] });
    };
  return (
    <RequireRole roles={['KYC_AGENT', 'SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Doublons biométriques"
          description="Similarité de visage ≥ 90 % entre deux dossiers : le nouveau compte est bloqué jusqu’à décision."
        />
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">Aucune alerte ouverte.</p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(a) => a.id}
                  columns={[
                    { header: 'Détecté', cell: (a) => formatDateTime(a.createdAt) },
                    { header: 'Similarité', cell: (a) => `${Math.round(a.similarityScore)} %` },
                    {
                      header: 'Nouveau dossier',
                      cell: (a) => (
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          href={`/kyc-review/${a.requestId}`}
                        >
                          Ouvrir
                        </Link>
                      ),
                    },
                    {
                      header: 'Membre existant',
                      cell: (a) => (
                        <code className="text-xs">{a.duplicateOfMemberId.slice(0, 8)}</code>
                      ),
                    },
                    {
                      header: 'Actions',
                      srOnlyHeader: true,
                      className: 'text-right space-x-2',
                      cell: (a) => (
                        <>
                          <ActionDialog
                            trigger="Écarter"
                            triggerVariant="outline"
                            title="Écarter l’alerte ?"
                            description="Les deux dossiers concernent des personnes distinctes ; la vérification reprend."
                            reason={{ label: 'Justification', required: true }}
                            successMessage="Alerte écartée"
                            onConfirm={resolve(a.id, 'DISMISSED')}
                          />
                          <ActionDialog
                            trigger="Confirmer"
                            confirmVariant="destructive"
                            title="Confirmer le doublon ?"
                            description="Le nouveau dossier sera rejeté (DOUBLON_CONFIRME)."
                            reason={{ label: 'Justification', required: true }}
                            successMessage="Doublon confirmé"
                            onConfirm={resolve(a.id, 'CONFIRMED')}
                          />
                        </>
                      ),
                    },
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
