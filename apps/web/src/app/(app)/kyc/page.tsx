'use client';

import { KYC_MAX_FILE_BYTES, KYC_MIN_HEIGHT, KYC_MIN_WIDTH } from '@tontine/contracts';
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
  Textarea,
  toast,
} from '@tontine/ui';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { DocumentInput, type ImageConstraints } from '@/components/kyc/document-input';
import { type SelfieResult, SelfieCapture } from '@/components/kyc/selfie-capture';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { KycMe, KycRequirements } from '@/lib/api/types';
import { loadCurrentUser } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { formatError } from '@/lib/forms';
import {
  KYC_DOCUMENT_LABELS,
  KYC_LEVEL_LABELS,
  KYC_REJECT_LABELS,
  KYC_STATUS_LABELS,
  label,
} from '@/lib/labels';

const IN_PROGRESS = new Set(['SUBMITTED', 'PROCESSING', 'REVIEW_REQUIRED']);

async function startLiveness(): Promise<string> {
  const res = await api.post<{ livenessToken: string }>('/kyc/liveness');
  return res.livenessToken;
}

function constraintsOf(r?: KycRequirements): ImageConstraints {
  return {
    maxFileBytes: r?.maxFileBytes ?? KYC_MAX_FILE_BYTES,
    minWidth: r?.minWidth ?? KYC_MIN_WIDTH,
    minHeight: r?.minHeight ?? KYC_MIN_HEIGHT,
  };
}

function SubmitIdentity({ requirements, onSubmitted }: { requirements: KycRequirements; onSubmitted: () => void }) {
  const [documentType, setDocumentType] = useState(requirements.documentTypes[0] ?? '');
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<SelfieResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const singleSided = requirements.singleSided.includes(documentType);
  const constraints = constraintsOf(requirements);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!documentType) errs.documentType = 'Choisissez un type de document';
    if (!front) errs.front = 'Le recto est obligatoire';
    if (!singleSided && !back) errs.back = 'Le verso est obligatoire pour ce document';
    if (!selfie) errs.selfie = 'Prenez un selfie avec la caméra';
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !front || !selfie) return;

    const data = new FormData();
    data.append('documentType', documentType);
    data.append('captureSource', 'CAMERA');
    data.append('livenessToken', selfie.livenessToken);
    data.append('front', front);
    if (!singleSided && back) data.append('back', back);
    data.append('selfie', new File([selfie.blob], 'selfie.jpg', { type: 'image/jpeg' }));
    setPending(true);
    setFormError(null);
    try {
      await api.post('/kyc/submit', data);
      toast.success('Documents envoyés', 'Vos documents sont en cours de vérification.');
      onSubmitted();
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField id="documentType" label="Type de pièce d’identité" error={errors.documentType} required>
        <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          {requirements.documentTypes.map((t) => (
            <option key={t} value={t}>
              {label(KYC_DOCUMENT_LABELS, t)}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <DocumentInput id="kyc-front" label="Recto" constraints={constraints} required onChange={setFront} error={errors.front} />
        {!singleSided ? (
          <DocumentInput id="kyc-back" label="Verso" constraints={constraints} required onChange={setBack} error={errors.back} />
        ) : (
          <p className="self-center text-sm text-muted-foreground">Ce document ne nécessite pas de verso.</p>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Selfie en direct <span className="text-destructive" aria-hidden="true">*</span>
        </legend>
        <SelfieCapture startLiveness={startLiveness} onCapture={setSelfie} onReset={() => setSelfie(null)} />
        {errors.selfie ? <p role="alert" className="text-center text-xs font-medium text-destructive">{errors.selfie}</p> : null}
      </fieldset>
      <Button type="submit" loading={pending}>
        Envoyer mon dossier
      </Button>
    </form>
  );
}

function Tier3Request({ onSubmitted }: { onSubmitted: () => void }) {
  const [incomeSource, setIncomeSource] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<SelfieResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (incomeSource.trim().length < 3) errs.incomeSource = '3 caractères minimum';
    if (!proof) errs.proof = 'Justificatif de domicile requis';
    if (!selfie) errs.selfie = 'Prenez un selfie avec la caméra';
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !proof || !selfie) return;
    const data = new FormData();
    data.append('incomeSource', incomeSource.trim());
    data.append('captureSource', 'CAMERA');
    data.append('livenessToken', selfie.livenessToken);
    data.append('proofOfAddress', proof);
    data.append('selfie', new File([selfie.blob], 'selfie.jpg', { type: 'image/jpeg' }));
    setPending(true);
    setFormError(null);
    try {
      await api.post('/kyc/tier3', data);
      toast.success('Demande envoyée', 'Votre demande de niveau 3 est en cours d’examen.');
      onSubmitted();
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField id="incomeSource" label="Source de revenus" error={errors.incomeSource} required>
        <Textarea value={incomeSource} onChange={(e) => setIncomeSource(e.target.value)} maxLength={500} />
      </FormField>
      <DocumentInput
        id="kyc-proof"
        label="Justificatif de domicile"
        constraints={constraintsOf()}
        required
        onChange={setProof}
        error={errors.proof}
      />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Selfie en direct</legend>
        <SelfieCapture startLiveness={startLiveness} onCapture={setSelfie} onReset={() => setSelfie(null)} />
        {errors.selfie ? <p role="alert" className="text-center text-xs font-medium text-destructive">{errors.selfie}</p> : null}
      </fieldset>
      <Button type="submit" loading={pending}>
        Demander le niveau 3
      </Button>
    </form>
  );
}

export default function KycPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['kyc', 'me'], queryFn: () => api.get<KycMe>('/kyc/me') });
  const requirements = useQuery({
    queryKey: ['kyc', 'requirements'],
    queryFn: () => api.get<KycRequirements>('/kyc/requirements'),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['kyc'] });
    await loadCurrentUser().catch(() => undefined);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vérification d’identité"
        description="Pièce d’identité et selfie en direct, vérifiés sous 24 h ouvrées."
      />
      <QueryState query={me} comingSoonTitle="Vérification d’identité bientôt disponible">
        {(k) => {
          const current = k.current;
          const inProgress = !!current && IN_PROGRESS.has(current.status);
          const canSubmit = !inProgress && (k.kycLevel === 'NONE' || k.kycLevel === 'TIER_1');
          return (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Statut</CardTitle>
                  <CardDescription>Niveau actuel : {label(KYC_LEVEL_LABELS, k.kycLevel)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {current ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      Dernier dossier ({label(KYC_DOCUMENT_LABELS, current.documentType)}) :
                      <StatusBadge status={current.status} labels={KYC_STATUS_LABELS} />
                      <span className="text-muted-foreground">soumis le {formatDateTime(current.submittedAt)}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Aucun dossier soumis.</p>
                  )}
                  {inProgress ? (
                    <Alert variant="info" title="Vos documents sont en cours de vérification">
                      Vous serez notifié dès qu’une décision sera prise.
                    </Alert>
                  ) : null}
                  {current?.status === 'REJECTED' ? (
                    <Alert variant="destructive" title="Dossier refusé">
                      {label(KYC_REJECT_LABELS, current.rejectCategory)}
                      {current.rejectReason ? ` — ${current.rejectReason}` : ''}. Vous pouvez soumettre un nouveau dossier.
                    </Alert>
                  ) : null}
                  {current?.status === 'SUPPLEMENT_REQUESTED' ? (
                    <Alert variant="warning" title="Compléments demandés">
                      {current.rejectReason ?? 'Un agent a demandé des documents complémentaires.'}
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>

              {canSubmit ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Soumettre mes documents</CardTitle>
                    <CardDescription>
                      Le selfie est pris en direct avec la caméra : aucune photo existante n’est acceptée.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <QueryState query={requirements} comingSoonTitle="Soumission bientôt disponible">
                      {(r) => <SubmitIdentity requirements={r} onSubmitted={() => void refresh()} />}
                    </QueryState>
                  </CardContent>
                </Card>
              ) : null}

              {k.kycLevel === 'TIER_2' && !inProgress ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Passer au niveau 3</CardTitle>
                    <CardDescription>Requis pour créer une tontine : justificatif de domicile, source de revenus et selfie.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tier3Request onSubmitted={() => void refresh()} />
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>Historique</CardTitle>
                </CardHeader>
                <CardContent>
                  {k.history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun historique.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Document</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead>Motif</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {k.history.map((h) => (
                          <TableRow key={h.id}>
                            <TableCell>{formatDateTime(h.submittedAt)}</TableCell>
                            <TableCell>{label(KYC_DOCUMENT_LABELS, h.documentType)}</TableCell>
                            <TableCell>
                              <StatusBadge status={h.status} labels={KYC_STATUS_LABELS} />
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {h.rejectCategory ? label(KYC_REJECT_LABELS, h.rejectCategory) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
