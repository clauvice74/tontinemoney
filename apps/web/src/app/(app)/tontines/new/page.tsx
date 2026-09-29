'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, LoadingBlock, toast } from '@tontine/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreateTontineForm } from '@/components/tontines/create-tontine-form';
import { api } from '@/lib/api';
import type { MemberView, TontineView } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { currencyForCountry } from '@/lib/money';
import { qk, useCurrentUser } from '@/lib/queries';

/** Création d'une tontine (US-4.1) puis invitations facultatives (US-4.2). */
export default function NewTontinePage() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const profile = useQuery({
    queryKey: qk.profile,
    queryFn: () => api.get<MemberView>('/me/profile'),
  });

  if (profile.isPending) return <LoadingBlock />;
  const eligible = user?.kycLevel === 'TIER_3' && user.memberStatus === 'ACTIVE';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-h1">{t('wizard.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('wizard.description')}</p>
      </div>
      {!eligible ? (
        <Alert variant="warning" title={t('wizard.eligibilityTitle')}>
          <p>{t('wizard.eligibilityBody')}</p>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link href="/kyc">{t('wizard.eligibilityCta')}</Link>
          </Button>
        </Alert>
      ) : null}
      <CreateTontineForm
        defaultCurrency={currencyForCountry(profile.data?.country)}
        onSubmit={async (values, invitees) => {
          const created = await api.post<TontineView>('/tontines', values);
          toast.success(t('wizard.created'), t('wizard.createdBody', { name: created.name }));
          if (invitees.length > 0) {
            // Envoi séquentiel : un échec n'empêche pas les suivants ; résumé en fin d'envoi.
            let failed = 0;
            for (const target of invitees) {
              try {
                await api.post(`/tontines/${created.id}/invitations`, target);
              } catch {
                failed += 1;
              }
            }
            const sent = invitees.length - failed;
            if (sent > 0) toast.success(t('wizard.invitationsSent', { count: sent }));
            if (failed > 0) toast.error(t('wizard.invitationsFailed', { count: failed }));
          }
          await queryClient.invalidateQueries({ queryKey: qk.tontines });
          router.push(`/tontines/${created.id}`);
        }}
      />
    </div>
  );
}
