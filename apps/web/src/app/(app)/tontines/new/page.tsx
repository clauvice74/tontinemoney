'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, LoadingBlock, toast } from '@tontine/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { CreateTontineForm } from '@/components/tontines/create-tontine-form';
import { api } from '@/lib/api';
import type { MemberView, TontineView } from '@/lib/api/types';
import { currencyForCountry } from '@/lib/money';
import { qk, useCurrentUser } from '@/lib/queries';

export default function NewTontinePage() {
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
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Créer une tontine"
        description="La tontine est créée en brouillon ; vous en devenez l’administrateur."
      />
      {!eligible ? (
        <Alert variant="warning" title="Vérification d’identité de niveau 3 requise" className="mb-6">
          <p>
            La création d’une tontine est réservée aux membres actifs vérifiés au niveau 3. Vous
            pouvez préparer la configuration, mais l’enregistrement sera refusé tant que ce niveau
            n’est pas atteint.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link href="/kyc">Compléter ma vérification</Link>
          </Button>
        </Alert>
      ) : null}
      <CreateTontineForm
        defaultCurrency={currencyForCountry(profile.data?.country)}
        onSubmit={async (values) => {
          const created = await api.post<TontineView>('/tontines', values);
          await queryClient.invalidateQueries({ queryKey: qk.tontines });
          toast.success('Tontine créée', `« ${created.name} » est en brouillon.`);
          router.push(`/tontines/${created.id}/admin`);
        }}
      />
    </div>
  );
}
