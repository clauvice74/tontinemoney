'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { FrequencyDetail } from '@tontine/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from '@tontine/ui';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { QueryState } from '@/components/feedback';
import { CreateTontineForm } from '@/components/tontines/create-tontine-form';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { TontineView } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { qk, useTontine } from '@/lib/queries';
import { isEditable } from '@/lib/tontines';

/** Valeurs du formulaire à partir de la vue tontine (montants en unités principales). */
function initialValuesOf(x: TontineView) {
  const p = x.penaltyRules ?? {};
  return {
    name: x.name,
    contributionAmount: x.contribution.amount,
    currency: x.contribution.currency,
    frequency: x.frequency,
    frequencyDetail: (x.frequencyDetail ?? {}) as FrequencyDetail,
    maxMembers: x.maxMembers,
    startDate: x.startDate.slice(0, 10),
    drawMode: x.drawMode,
    penaltyRules: {
      graceDays: p.graceDays ?? 3,
      lateFeePercent: p.lateFeePercent ?? 5,
      suspendAfter: p.suspendAfter ?? 3,
      defaultAfterDays: p.defaultAfterDays ?? 7,
    },
    entryFee: x.entryFee?.amount,
    collation: x.collation?.amount,
    incompletePolicy: x.incompletePolicy,
  };
}

/** A-61 — modification de la configuration avant démarrage (administrateur de la tontine). */
export default function TontineSettingsPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tontine = useTontine(id);

  return (
    <QueryState query={tontine}>
      {(x) =>
        !isEditable(x) ? (
          <Alert variant="info" title={t('adminT.settings.lockedTitle')}>
            <p>{t('adminT.settings.lockedBody')}</p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link href={`/tontines/${id}/admin`}>{t('adminT.tabs.dashboard')}</Link>
            </Button>
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t('adminT.settings.title')}</CardTitle>
              <CardDescription>{t('adminT.settings.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateTontineForm
                key={x.version}
                mode="edit"
                defaultCurrency={x.contribution.currency}
                initialValues={initialValuesOf(x)}
                submitLabel={t('adminT.settings.save')}
                onSubmit={async (values) => {
                  try {
                    await api.patch<TontineView>(`/tontines/${id}`, {
                      ...values,
                      currency: x.contribution.currency,
                      version: x.version,
                    });
                  } catch (e) {
                    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
                      toast.error(t('adminT.settings.conflict'));
                      await queryClient.invalidateQueries({ queryKey: qk.tontine(id) });
                      return;
                    }
                    throw e;
                  }
                  toast.success(t('adminT.settings.saved'));
                  await queryClient.invalidateQueries({ queryKey: qk.tontines });
                  router.push(`/tontines/${id}/admin`);
                }}
              />
            </CardContent>
          </Card>
        )
      }
    </QueryState>
  );
}
