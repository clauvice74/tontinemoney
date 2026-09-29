'use client';

import { KYC_MAX_FILE_BYTES, KYC_MIN_HEIGHT, KYC_MIN_WIDTH } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
  FormField,
  Select,
  Stepper,
  Textarea,
  Timeline,
  type TimelineItem,
  cn,
  toast,
} from '@tontine/ui';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { QueryState } from '@/components/feedback';
import { DocumentInput, type ImageConstraints } from '@/components/kyc/document-input';
import { type SelfieResult, SelfieCapture } from '@/components/kyc/selfie-capture';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { KycMe, KycRequestSummary, KycRequirements } from '@/lib/api/types';
import { loadCurrentUser } from '@/lib/auth/session';
import { formatError } from '@/lib/forms';
import { type MessageKey, useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { kycAtLeast } from '@/lib/kyc';

const IN_PROGRESS = new Set(['SUBMITTED', 'PROCESSING', 'REVIEW_REQUIRED']);
const LEVELS = ['TIER_1', 'TIER_2', 'TIER_3'] as const;

type KycState = 'required' | 'inProgress' | 'validated' | 'rejected' | 'supplement';

/** État lisible du dossier (charte UX : « statut visible avant toute action »). */
function stateOf(k: KycMe): KycState {
  const s = k.current?.status;
  if (s && IN_PROGRESS.has(s)) return 'inProgress';
  if (s === 'SUPPLEMENT_REQUESTED') return 'supplement';
  if (s === 'REJECTED') return 'rejected';
  return kycAtLeast(k.kycLevel, 'TIER_2') ? 'validated' : 'required';
}

const STATE_STYLE: Record<KycState, { icon: typeof Clock; className: string }> = {
  required: { icon: ShieldAlert, className: 'bg-gold-pale text-warning' },
  inProgress: { icon: Clock, className: 'bg-secondary text-info' },
  validated: { icon: CheckCircle2, className: 'bg-success-soft text-success' },
  rejected: { icon: XCircle, className: 'bg-destructive-soft text-destructive' },
  supplement: { icon: AlertTriangle, className: 'bg-gold-pale text-warning' },
};

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

/** Aperçu local d'un fichier (URL libérée au démontage). */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function Thumb({
  blob,
  label,
  mirrored,
}: {
  blob: Blob | null;
  label: string;
  mirrored?: boolean;
}) {
  const url = useObjectUrl(blob);
  return (
    <figure className="space-y-1">
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted">
        {url ? (
          <Image
            src={url}
            alt={label}
            fill
            unoptimized
            className={cn('object-cover', mirrored && '[transform:scaleX(-1)]')}
          />
        ) : null}
      </div>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** Statut du dossier : état, motif éventuel, étapes, niveaux et ce qu'ils débloquent. */
function StatusCard({ k }: { k: KycMe }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const state = stateOf(k);
  const { icon: Icon, className } = STATE_STYLE[state];
  const current = k.current;
  const timeline: TimelineItem[] = current
    ? [
        {
          id: 'sent',
          title: t('kyc.timeline.sent'),
          meta: f.dateTime(current.submittedAt),
          status: 'done',
        },
        {
          id: 'review',
          title: t('kyc.timeline.review'),
          status: state === 'inProgress' ? 'current' : 'done',
        },
        {
          id: 'decision',
          title: t('kyc.timeline.decision'),
          meta: current.decidedAt ? f.dateTime(current.decidedAt) : undefined,
          status:
            state === 'inProgress'
              ? 'upcoming'
              : state === 'rejected'
                ? 'failed'
                : state === 'supplement'
                  ? 'current'
                  : 'done',
        },
      ]
    : [];
  return (
    <Card>
      <CardContent className="grid gap-6 pt-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn('grid size-11 shrink-0 place-items-center rounded-full', className)}
            >
              <Icon className="size-5" />
            </span>
            <div className="space-y-1">
              <h2 className="text-h3">{t(`kyc.state.${state}` as MessageKey)}</h2>
              <p className="text-sm text-muted-foreground">
                {t(`kyc.stateHelp.${state}` as MessageKey)}
              </p>
              <p className="text-sm">
                {t('kyc.level', { level: labels.kycLevel[k.kycLevel] ?? k.kycLevel })}
              </p>
            </div>
          </div>
          {state === 'rejected' && current ? (
            <Alert variant="destructive" title={t('kyc.state.rejected')}>
              {t('kyc.reason', {
                reason: [
                  current.rejectCategory
                    ? (labels.kycReject[current.rejectCategory] ?? current.rejectCategory)
                    : null,
                  current.rejectReason,
                ]
                  .filter(Boolean)
                  .join(' — '),
              })}
            </Alert>
          ) : null}
          {state === 'supplement' && current?.rejectReason ? (
            <Alert variant="warning" title={t('kyc.state.supplement')}>
              {current.rejectReason}
            </Alert>
          ) : null}
          {timeline.length > 0 ? (
            <Timeline
              items={timeline}
              statusLabels={{
                done: t('kyc.state.validated'),
                current: t('kyc.state.inProgress'),
                upcoming: t('kyc.timeline.decision'),
                failed: t('kyc.state.rejected'),
              }}
            />
          ) : null}
        </div>
        <section aria-labelledby="kyc-levels" className="rounded-md bg-muted p-4">
          <h3 id="kyc-levels" className="mb-3 text-sm font-medium">
            {t('kyc.levels')}
          </h3>
          <ol className="space-y-3">
            {LEVELS.map((l) => {
              const reached = kycAtLeast(k.kycLevel, l);
              return (
                <li key={l} className="flex items-start gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium',
                      reached ? 'bg-success text-white' : 'border bg-card text-muted-foreground',
                    )}
                  >
                    {l.slice(-1)}
                  </span>
                  <span className="flex-1">
                    <span className="font-medium">{labels.kycLevel[l]}</span>
                    <span className="block text-muted-foreground">
                      {t(`kyc.levelUnlocks.${l}` as MessageKey)}
                    </span>
                  </span>
                  {reached ? <Badge variant="success">{t('kyc.reached')}</Badge> : null}
                </li>
              );
            })}
          </ol>
        </section>
      </CardContent>
    </Card>
  );
}

/** Envoi guidé : pièce (recto / verso) → selfie en direct → vérification et envoi. */
function SubmitIdentity({
  requirements,
  onSubmitted,
}: {
  requirements: KycRequirements;
  onSubmitted: () => void;
}) {
  const { t } = useI18n();
  const labels = useLabels();
  const [step, setStep] = useState(0);
  const [documentType, setDocumentType] = useState(requirements.documentTypes[0] ?? '');
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<SelfieResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const singleSided = requirements.singleSided.includes(documentType);
  const constraints = constraintsOf(requirements);
  const steps = [t('kyc.steps.document'), t('kyc.steps.selfie'), t('kyc.steps.review')];

  function checkDocument(): boolean {
    const errs: Record<string, string> = {};
    if (!documentType) errs.documentType = t('kyc.errors.documentType');
    if (!front) errs.front = t('kyc.errors.front');
    if (!singleSided && !back) errs.back = t('kyc.errors.back');
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 0) {
      if (checkDocument()) setStep(1);
      return;
    }
    if (step === 1) {
      if (!selfie) {
        setErrors({ selfie: t('kyc.errors.selfie') });
        return;
      }
      setErrors({});
      setStep(2);
      return;
    }
    if (!front || !selfie) return;
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
      toast.success(t('kyc.sentTitle'), t('kyc.sentBody'));
      onSubmitted();
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6" noValidate>
      <Stepper steps={steps} current={step} label={t('kyc.stepsLabel')} />
      {formError ? <Alert variant="destructive" title={formError} /> : null}

      <div hidden={step !== 0} className="space-y-5">
        <FormField
          id="documentType"
          label={t('kyc.documentType')}
          error={errors.documentType}
          required
        >
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            {requirements.documentTypes.map((d) => (
              <option key={d} value={d}>
                {labels.kycDocument[d] ?? d}
              </option>
            ))}
          </Select>
        </FormField>
        <p className="text-sm text-muted-foreground">{t('kyc.tips')}</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <DocumentInput
            id="kyc-front"
            label={t('kyc.front')}
            constraints={constraints}
            required
            onChange={setFront}
            error={errors.front}
          />
          {!singleSided ? (
            <DocumentInput
              id="kyc-back"
              label={t('kyc.back')}
              constraints={constraints}
              required
              onChange={setBack}
              error={errors.back}
            />
          ) : (
            <p className="self-center text-sm text-muted-foreground">{t('kyc.noBack')}</p>
          )}
        </div>
      </div>

      <div hidden={step !== 1} className="space-y-2">
        <h3 className="text-sm font-medium">{t('kyc.selfieTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('kyc.selfieHelp')}</p>
        {step === 1 && selfie ? (
          <div className="mx-auto max-w-xs space-y-2 text-center">
            <Thumb blob={selfie.blob} label={t('kyc.selfieTaken')} mirrored />
            <Button type="button" variant="outline" size="sm" onClick={() => setSelfie(null)}>
              {t('kyc.selfie.retake')}
            </Button>
          </div>
        ) : step === 1 ? (
          <SelfieCapture
            startLiveness={startLiveness}
            onCapture={setSelfie}
            onReset={() => setSelfie(null)}
          />
        ) : null}
        {errors.selfie ? <FieldError className="text-center">{errors.selfie}</FieldError> : null}
      </div>

      {step === 2 ? (
        <section aria-labelledby="kyc-review" className="space-y-3">
          <h3 id="kyc-review" className="text-sm font-medium">
            {t('kyc.reviewTitle')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {labels.kycDocument[documentType] ?? documentType} — {t('kyc.reviewHelp')}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Thumb blob={front} label={t('kyc.front')} />
            {!singleSided ? <Thumb blob={back} label={t('kyc.back')} /> : null}
            <Thumb blob={selfie?.blob ?? null} label={t('kyc.selfieTaken')} mirrored />
          </div>
        </section>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
            {t('kyc.back_')}
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          variant={step === 2 ? 'primary' : 'secondary'}
          size="lg"
          loading={pending}
        >
          {step === 2 ? t('kyc.submit') : t('kyc.next')}
        </Button>
      </div>
    </form>
  );
}

function Tier3Request({ onSubmitted }: { onSubmitted: () => void }) {
  const { t } = useI18n();
  const [incomeSource, setIncomeSource] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<SelfieResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (incomeSource.trim().length < 3) errs.incomeSource = t('kyc.errors.incomeSource');
    if (!proof) errs.proof = t('kyc.errors.proof');
    if (!selfie) errs.selfie = t('kyc.errors.selfie');
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
      toast.success(t('kyc.sentTitle'), t('kyc.tier3Sent'));
      onSubmitted();
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField
        id="incomeSource"
        label={t('kyc.incomeSource')}
        error={errors.incomeSource}
        required
      >
        <Textarea
          value={incomeSource}
          onChange={(e) => setIncomeSource(e.target.value)}
          maxLength={500}
        />
      </FormField>
      <DocumentInput
        id="kyc-proof"
        label={t('kyc.proofOfAddress')}
        constraints={constraintsOf()}
        required
        onChange={setProof}
        error={errors.proof}
      />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('kyc.selfieTitle')}</h3>
        <SelfieCapture
          startLiveness={startLiveness}
          onCapture={setSelfie}
          onReset={() => setSelfie(null)}
        />
        {errors.selfie ? <FieldError className="text-center">{errors.selfie}</FieldError> : null}
      </div>
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        {t('kyc.tier3Submit')}
      </Button>
    </form>
  );
}

function History({ items }: { items: KycRequestSummary[] }) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">{t('kyc.historyEmpty')}</p>;
  return (
    <ul className="divide-y rounded-md border">
      {items.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <div>
            <p className="font-medium">{labels.kycDocument[h.documentType] ?? h.documentType}</p>
            <p className="text-xs text-muted-foreground">
              {t('kyc.submittedOn', { date: f.dateTime(h.submittedAt) })}
              {h.rejectCategory
                ? ` · ${labels.kycReject[h.rejectCategory] ?? h.rejectCategory}`
                : ''}
            </p>
          </div>
          <StatusBadge status={h.status} labels={labels.kycStatus} />
        </li>
      ))}
    </ul>
  );
}

/** Vérification d'identité (US-3.1 à US-3.4) : statut, envoi guidé, niveau 3, historique. */
export default function KycPage() {
  const { t } = useI18n();
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
      <div className="space-y-1">
        <h1 className="text-h1">{t('kyc.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('kyc.description')}</p>
      </div>
      <QueryState query={me}>
        {(k) => {
          const state = stateOf(k);
          const canSubmit =
            state !== 'inProgress' && (k.kycLevel === 'NONE' || k.kycLevel === 'TIER_1');
          return (
            <>
              <StatusCard k={k} />
              {canSubmit ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('kyc.submitTitle')}</CardTitle>
                    <CardDescription>{t('kyc.submitDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <QueryState query={requirements}>
                      {(r) => (
                        <SubmitIdentity requirements={r} onSubmitted={() => void refresh()} />
                      )}
                    </QueryState>
                  </CardContent>
                </Card>
              ) : null}
              {k.kycLevel === 'TIER_2' && state !== 'inProgress' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('kyc.tier3Title')}</CardTitle>
                    <CardDescription>{t('kyc.tier3Description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tier3Request onSubmitted={() => void refresh()} />
                  </CardContent>
                </Card>
              ) : null}
              <Card>
                <CardHeader>
                  <CardTitle>{t('kyc.historyTitle')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <History items={k.history} />
                </CardContent>
              </Card>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
