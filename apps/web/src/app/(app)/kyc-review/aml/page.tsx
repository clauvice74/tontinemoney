'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@tontine/ui';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';

interface AmlMatch {
  id: string;
  memberId: string;
  listName: string;
  entryName: string;
  entryCountry: string | null;
  entryReason: string;
  entryAddedAt: string | null;
  score: number;
  source: string;
  createdAt: string;
}

/** US-3.5 — correspondances OFAC / ONU / UE / Interpol / PEP : revue humaine obligatoire. */
export default function KycAmlPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['kyc', 'aml'],
    queryFn: () => api.get<{ data: AmlMatch[] }>('/kyc/aml-matches'),
  });
  const resolve =
    (id: string, resolution: 'CONFIRMED_MATCH' | 'FALSE_POSITIVE') => async (comment: string) => {
      await api.post(`/kyc/aml-matches/${id}/resolve`, { resolution, comment });
      await queryClient.invalidateQueries({ queryKey: ['kyc'] });
    };
  return (
    <RequireRole roles={['KYC_AGENT', 'COMPLIANCE_AGENT', 'SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Correspondances AML"
          description="Listes de test fictives (simulation). Un faux positif alimente la liste blanche ; une correspondance confirmée suspend le compte."
        />
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucune correspondance ouverte.
            </p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(m) => m.id}
                  columns={[
                    { header: 'Détectée', cell: (m) => formatDateTime(m.createdAt) },
                    {
                      header: 'Liste',
                      cell: (m) => <Badge variant="destructive">{m.listName}</Badge>,
                    },
                    { header: 'Entrée', cell: (m) => `${m.entryName} (${m.entryCountry ?? '—'})` },
                    { header: 'Motif', cell: (m) => m.entryReason },
                    { header: 'Ajoutée le', cell: (m) => formatDate(m.entryAddedAt) },
                    { header: 'Score', cell: (m) => `${Math.round(m.score)} %` },
                    {
                      header: 'Origine',
                      cell: (m) => (m.source === 'BATCH' ? 'Batch quotidien' : 'Soumission'),
                    },
                    {
                      header: 'Actions',
                      srOnlyHeader: true,
                      className: 'text-right space-x-2',
                      cell: (m) => (
                        <>
                          <ActionDialog
                            trigger="Faux positif"
                            triggerVariant="outline"
                            title="Marquer comme faux positif ?"
                            description="L’entrée sera ajoutée à la liste blanche de ce membre."
                            reason={{ label: 'Justification', required: true }}
                            successMessage="Faux positif enregistré"
                            onConfirm={resolve(m.id, 'FALSE_POSITIVE')}
                          />
                          <ActionDialog
                            trigger="Confirmer"
                            confirmVariant="destructive"
                            title="Confirmer la correspondance ?"
                            description="Le compte sera suspendu et le dossier rejeté."
                            reason={{ label: 'Justification', required: true }}
                            successMessage="Correspondance confirmée"
                            onConfirm={resolve(m.id, 'CONFIRMED_MATCH')}
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
