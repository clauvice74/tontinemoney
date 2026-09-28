'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent, CardHeader, LoadingBlock } from '@tontine/ui';
import { MailCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Amount } from '@/components/amount';
import { ErrorAlert } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { InvitationView } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';

type InvitationPreview = InvitationView & { spotsLeft?: number };

/**
 * Invitation par lien (US-4.2) : aperçu public (nom, montant, fréquence, début, places),
 * puis connexion ou demande de compte, puis « Rejoindre la tontine ».
 */
export default function InvitationPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const status = useAuthStore((s) => s.status);

  const preview = useQuery({
    queryKey: ['invitation-code', code],
    queryFn: () =>
      api.get<InvitationPreview>(`/invitations/code/${encodeURIComponent(code)}`, {
        auth: false,
      }),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      api.post<{ tontineId?: string }>(`/invitations/code/${encodeURIComponent(code)}/accept`),
    onSuccess: (res) => {
      const id = res?.tontineId ?? preview.data?.tontine?.id;
      router.push(id ? `/tontines/${id}` : '/tontines');
    },
  });

  const reasons =
    accept.error instanceof ApiError && Array.isArray(accept.error.body.reasons)
      ? (accept.error.body.reasons as unknown[]).map(String)
      : [];
  const inv = preview.data;
  const active = inv?.status === 'PENDING' && (inv.spotsLeft ?? 1) > 0;

  return (
    <div className="mx-auto max-w-lg px-4 py-10 md:py-16">
      <Card>
        <CardHeader className="space-y-3">
          <span
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-full bg-secondary text-info"
          >
            <MailCheck className="size-5" />
          </span>
          <h1 className="text-h2">{t('invitation.title')}</h1>
        </CardHeader>
        <CardContent className="space-y-5">
          {preview.isPending ? (
            <LoadingBlock />
          ) : preview.isError ? (
            preview.error instanceof ApiError && preview.error.status === 404 ? (
              <Alert variant="warning" title={t('invitation.invalid')}>
                {t('invitation.invalidBody')}
              </Alert>
            ) : (
              <ErrorAlert error={preview.error} onRetry={() => void preview.refetch()} />
            )
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('invitation.invitedTo')}</p>
                <p className="text-h3 font-medium">{inv?.tontine?.name ?? '—'}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted p-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('tontine.contribution')}</dt>
                  <dd>
                    <Amount value={inv?.tontine?.contribution} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('tontine.frequency')}</dt>
                  <dd className="font-medium">
                    {inv?.tontine?.frequency
                      ? (labels.frequency[inv.tontine.frequency] ?? inv.tontine.frequency)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('tontine.startDate')}</dt>
                  <dd className="font-medium">{f.date(inv?.tontine?.startDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('invitation.status')}</dt>
                  <dd>
                    <StatusBadge status={inv?.status} labels={labels.invitationStatus} />
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {inv?.spotsLeft !== undefined ? (
                  <span className="flex items-center gap-1">
                    <Users className="size-4" aria-hidden="true" />
                    {t('invitation.spotsLeft', { count: inv.spotsLeft })}
                  </span>
                ) : null}
                <span>{t('tontines.expires', { date: f.date(inv?.expiresAt) })}</span>
              </div>

              {!active ? (
                <Alert variant="warning" title={t('invitation.notActive')}>
                  {t('invitation.invalidBody')}
                </Alert>
              ) : status === 'unknown' ? (
                <LoadingBlock />
              ) : status !== 'authenticated' ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('invitation.requirements')}</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button asChild variant="primary" size="lg">
                      <Link href={`/login?next=${encodeURIComponent(`/invitations/${code}`)}`}>
                        {t('invitation.loginToAccept')}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg">
                      <Link href={`/request-account?code=${encodeURIComponent(code)}`}>
                        {t('invitation.signupToAccept')}
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {accept.isError ? (
                    reasons.length > 0 ? (
                      <Alert variant="warning" title={t('tontines.notEligible')}>
                        <ul className="list-disc pl-4">
                          {reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </Alert>
                    ) : (
                      <ErrorAlert error={accept.error} />
                    )
                  ) : null}
                  <p className="text-sm text-muted-foreground">{t('invitation.requirements')}</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => accept.mutate()}
                      loading={accept.isPending}
                    >
                      {t('invitation.accept')}
                    </Button>
                    <Button asChild variant="ghost" size="lg">
                      <Link href="/tontines">{t('invitation.later')}</Link>
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
