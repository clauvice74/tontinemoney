'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, LoadingBlock } from '@tontine/ui';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ErrorAlert } from '@/components/feedback';
import { Money } from '@/components/money';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { MoneyView } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { formatDate } from '@/lib/format';
import { FREQUENCY_LABELS, label } from '@/lib/labels';

interface InvitationPreview {
  tontine?: {
    id: string;
    name: string;
    contribution?: MoneyView;
    frequency?: string;
    startDate?: string;
    memberCount?: number;
    maxMembers?: number;
  };
  expiresAt?: string;
  status?: string;
}

export default function InvitationPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  const preview = useQuery({
    queryKey: ['invitation-code', code],
    queryFn: () => api.get<InvitationPreview>(`/invitations/code/${encodeURIComponent(code)}`),
    enabled: status === 'authenticated',
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

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card>
        <CardHeader>
          <MailCheck className="size-6 text-primary" aria-hidden="true" />
          <CardTitle>
            <span className="text-xl">Invitation à rejoindre une tontine</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'unknown' ? <LoadingBlock /> : null}
          {status === 'anonymous' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Connectez-vous pour consulter et accepter cette invitation. Vous n’avez pas encore
                de compte ? Faites une demande avec ce code d’invitation.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/login?next=${encodeURIComponent(`/invitations/${code}`)}`}>
                    Se connecter
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/request-account?code=${encodeURIComponent(code)}`}>
                    Demander un compte
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
          {status === 'authenticated' ? (
            preview.isPending ? (
              <LoadingBlock />
            ) : preview.isError ? (
              preview.error instanceof ApiError && preview.error.status === 404 ? (
                <Alert variant="warning" title="Invitation introuvable ou expirée">
                  Ce lien n’est plus valide (expiration après 7 jours, révocation ou tontine
                  complète). Demandez un nouveau lien à l’administrateur de la tontine.
                </Alert>
              ) : (
                <ErrorAlert error={preview.error} onRetry={() => void preview.refetch()} />
              )
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Tontine</dt>
                    <dd className="text-lg font-medium">{preview.data.tontine?.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Cotisation</dt>
                    <dd className="font-medium">
                      <Money value={preview.data.tontine?.contribution} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Fréquence</dt>
                    <dd className="font-medium">
                      {label(FREQUENCY_LABELS, preview.data.tontine?.frequency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Début</dt>
                    <dd className="font-medium">{formatDate(preview.data.tontine?.startDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Expire le</dt>
                    <dd className="font-medium">{formatDate(preview.data.expiresAt)}</dd>
                  </div>
                </dl>
                {accept.isError ? (
                  reasons.length > 0 ? (
                    <Alert variant="warning" title="Vous n’êtes pas encore éligible">
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
                <Button onClick={() => accept.mutate()} loading={accept.isPending}>
                  Accepter l’invitation
                </Button>
              </>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
