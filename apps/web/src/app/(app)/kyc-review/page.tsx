'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent } from '@tontine/ui';
import Link from 'next/link';
import { QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { KYC_DOCUMENT_LABELS, KYC_STEP_LABELS, label } from '@/lib/labels';

interface QueueItem {
  id: string;
  memberId: string;
  member: { id: string; firstName: string; lastName: string; countryCode: string | null } | null;
  targetLevel: string;
  documentType: string;
  submittedAt: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  flags: Array<{ step: string; outcome: string; score: number | null }>;
}

/** US-3.3 — file de revue manuelle, triée par ancienneté, avec SLA de 24 h ouvrées. */
export default function KycReviewQueuePage() {
  const query = useQuery({
    queryKey: ['kyc', 'reviews'],
    queryFn: () => api.get<{ data: QueueItem[] }>('/kyc/reviews'),
    refetchInterval: 30_000,
  });
  return (
    <RequireRole roles={['KYC_AGENT', 'SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="File de revue KYC"
          description="Dossiers escaladés, du plus ancien au plus récent. SLA : 24 h ouvrées."
        />
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucun dossier en attente de revue.
            </p>
          }
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(r) => r.id}
                  columns={[
                    {
                      header: 'Membre',
                      cell: (r) =>
                        r.member
                          ? `${r.member.firstName} ${r.member.lastName}`
                          : r.memberId.slice(0, 8),
                    },
                    { header: 'Pays', cell: (r) => r.member?.countryCode ?? '—' },
                    {
                      header: 'Niveau visé',
                      cell: (r) => r.targetLevel.replace('TIER_', 'Niveau '),
                    },
                    { header: 'Pièce', cell: (r) => label(KYC_DOCUMENT_LABELS, r.documentType) },
                    { header: 'Soumis', cell: (r) => formatDateTime(r.submittedAt) },
                    {
                      header: 'SLA',
                      cell: (r) =>
                        r.slaBreached ? (
                          <Badge variant="destructive">Dépassé</Badge>
                        ) : r.slaDueAt ? (
                          <span className="text-sm">{formatRelative(r.slaDueAt)}</span>
                        ) : (
                          '—'
                        ),
                    },
                    {
                      header: 'Contrôles à revoir',
                      cell: (r) =>
                        r.flags.length
                          ? r.flags.map((f) => (
                              <Badge
                                key={f.step}
                                variant={f.outcome === 'FAIL' ? 'destructive' : 'warning'}
                                className="mr-1"
                              >
                                {label(KYC_STEP_LABELS, f.step)}
                                {f.score !== null ? ` ${Math.round(f.score)} %` : ''}
                              </Badge>
                            ))
                          : '—',
                    },
                    {
                      header: 'Action',
                      srOnlyHeader: true,
                      className: 'text-right',
                      cell: (r) => (
                        <Link
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href={`/kyc-review/${r.id}`}
                        >
                          Examiner
                        </Link>
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
