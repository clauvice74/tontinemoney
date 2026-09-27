'use client';

import { KYC_REJECT_CATEGORIES } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
  Textarea,
  toast,
} from '@tontine/ui';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorAlert, QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime } from '@/lib/format';
import {
  KYC_DOCUMENT_LABELS,
  KYC_LEVEL_LABELS,
  KYC_REJECT_LABELS,
  KYC_STATUS_LABELS,
  KYC_STEP_LABELS,
  label,
} from '@/lib/labels';

interface Detail {
  id: string;
  status: string;
  targetLevel: string;
  documentType: string;
  documentCountry: string | null;
  documentExpiresAt: string | null;
  incomeSource: string | null;
  submittedAt: string;
  slaDueAt: string | null;
  extracted: Record<string, unknown> | null;
  member: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    country: string | null;
    status: string;
    kycLevel: string;
  } | null;
  documents: Array<{
    id: string;
    kind: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    sizeBytes: number;
  }>;
  checks: Array<{ step: string; outcome: string; score: number | null; attempts: number }>;
  alerts: {
    duplicates: Array<{ id: string; similarityScore: number; status: string }>;
    aml: Array<{
      id: string;
      listName: string;
      entryName: string;
      entryReason: string;
      score: number;
      status: string;
    }>;
  };
  previousSubmissions: Array<{
    id: string;
    status: string;
    submittedAt: string;
    rejectCategory: string | null;
  }>;
}

const KIND_LABELS: Record<string, string> = {
  ID_FRONT: 'Recto',
  ID_BACK: 'Verso',
  SELFIE: 'Selfie (caméra)',
  PROOF_OF_ADDRESS: 'Justificatif de domicile',
};

/** Aperçu d'un document : l'image est récupérée avec le jeton (accès journalisé côté API). */
function DocumentPreview({ id, kind }: { id: string; kind: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    api
      .get<Blob>(`/kyc/documents/${id}`, { responseType: 'blob' })
      .then((blob) => {
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => setError(true));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [id]);
  return (
    <figure className="space-y-1">
      <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-md border bg-muted">
        {url ? (
          // URL blob locale d'un document déchiffré et authentifié : il ne doit pas transiter par l'optimiseur d'images Next.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label(KIND_LABELS, kind)} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">
            {error ? 'Aperçu indisponible' : 'Chargement…'}
          </span>
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">{label(KIND_LABELS, kind)}</figcaption>
    </figure>
  );
}

function DecisionForm({ request, onDone }: { request: Detail; onDone: () => void }) {
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | 'REQUEST_SUPPLEMENT'>('APPROVE');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string>(KYC_REJECT_CATEGORIES[0]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const amlOpen = request.alerts.aml.some((m) => m.status === 'OPEN');
  const tooShort = action === 'APPROVE' ? text.trim().length < 10 : text.trim().length < 1;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body =
        action === 'APPROVE'
          ? { action, annotation: text }
          : action === 'REJECT'
            ? { action, category, comment: text }
            : { action, comment: text };
      await api.post(`/kyc/requests/${request.id}/decision`, body);
      toast.success(
        action === 'APPROVE'
          ? 'Dossier validé'
          : action === 'REJECT'
            ? 'Dossier rejeté'
            : 'Complément demandé',
      );
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Décision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {amlOpen ? (
          <p className="rounded-md border border-warning p-2 text-sm">
            Une correspondance AML est ouverte : elle doit être traitée par un humain (aucune
            décision automatique définitive).
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="kyc-action">Action</Label>
          <Select
            id="kyc-action"
            value={action}
            onChange={(e) => setAction(e.target.value as typeof action)}
          >
            <option value="APPROVE">Accepter</option>
            <option value="REJECT">Rejeter</option>
            <option value="REQUEST_SUPPLEMENT">Demander un complément</option>
          </Select>
        </div>
        {action === 'REJECT' ? (
          <div className="space-y-1.5">
            <Label htmlFor="kyc-category">Catégorie de rejet</Label>
            <Select
              id="kyc-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {KYC_REJECT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(KYC_REJECT_LABELS, c)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="kyc-text">
            {action === 'APPROVE'
              ? 'Annotation (10 caractères minimum)'
              : 'Commentaire pour le membre'}
          </Label>
          <Textarea id="kyc-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {error ? <ErrorAlert error={error} /> : null}
        <Button
          onClick={submit}
          disabled={busy || tooShort}
          variant={action === 'REJECT' ? 'destructive' : 'default'}
        >
          {busy ? 'Enregistrement…' : 'Enregistrer la décision'}
        </Button>
      </CardContent>
    </Card>
  );
}

/** US-3.3 — examen d'un dossier : documents, scores, alertes, historique, décision journalisée. */
export default function KycReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['kyc', 'request', id],
    queryFn: () => api.get<Detail>(`/kyc/requests/${id}`),
  });

  return (
    <RequireRole roles={['KYC_AGENT', 'SUPER_ADMIN']}>
      <QueryState query={query}>
        {(r) => (
          <div className="space-y-4">
            <PageHeader
              title={r.member ? `${r.member.firstName} ${r.member.lastName}` : 'Dossier KYC'}
              description={`${label(KYC_DOCUMENT_LABELS, r.documentType)} · soumis le ${formatDateTime(r.submittedAt)} · ${label(KYC_STATUS_LABELS, r.status)}`}
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Documents</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    {r.documents.map((d) => (
                      <div key={d.id}>
                        <DocumentPreview id={d.id} kind={d.kind} />
                        <p className="text-xs text-muted-foreground">
                          {d.width}×{d.height} · {formatBytes(d.sizeBytes)}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Contrôles automatiques</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SimpleTable
                      rows={r.checks}
                      rowKey={(c) => c.step}
                      columns={[
                        { header: 'Étape', cell: (c) => label(KYC_STEP_LABELS, c.step) },
                        {
                          header: 'Résultat',
                          cell: (c) => (
                            <Badge
                              variant={
                                c.outcome === 'PASS'
                                  ? 'success'
                                  : c.outcome === 'FAIL'
                                    ? 'destructive'
                                    : 'warning'
                              }
                            >
                              {c.outcome}
                            </Badge>
                          ),
                        },
                        {
                          header: 'Score',
                          cell: (c) => (c.score !== null ? `${Math.round(c.score)} %` : '—'),
                        },
                        { header: 'Tentatives', cell: (c) => c.attempts },
                      ]}
                    />
                  </CardContent>
                </Card>
                {r.alerts.aml.length || r.alerts.duplicates.length ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Alertes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {r.alerts.aml.map((m) => (
                        <p key={m.id}>
                          <Badge variant="destructive">{m.listName}</Badge> {m.entryName} —{' '}
                          {m.entryReason} (score {Math.round(m.score)} %, {m.status})
                        </p>
                      ))}
                      {r.alerts.duplicates.map((d) => (
                        <p key={d.id}>
                          <Badge variant="warning">Doublon</Badge> similarité{' '}
                          {Math.round(d.similarityScore)} % ({d.status})
                        </p>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Identité</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <p>Né(e) le : {formatDate(r.member?.dateOfBirth ?? null)}</p>
                    <p>
                      Pays du profil : {r.member?.country ?? '—'} · pays de la pièce :{' '}
                      {r.documentCountry ?? '—'}
                    </p>
                    <p>Expiration de la pièce : {formatDate(r.documentExpiresAt)}</p>
                    <p>
                      Niveau actuel : {label(KYC_LEVEL_LABELS, r.member?.kycLevel ?? 'NONE')} → visé
                      : {label(KYC_LEVEL_LABELS, r.targetLevel)}
                    </p>
                    {r.incomeSource ? <p>Source de revenus : {r.incomeSource}</p> : null}
                    {r.previousSubmissions.length ? (
                      <p className="pt-2 text-muted-foreground">
                        {r.previousSubmissions.length} soumission(s) précédente(s)
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
                {['REVIEW_REQUIRED', 'PROCESSING', 'SUBMITTED'].includes(r.status) ? (
                  <DecisionForm
                    request={r}
                    onDone={async () => {
                      await queryClient.invalidateQueries({ queryKey: ['kyc'] });
                      router.push('/kyc-review');
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </RequireRole>
  );
}
