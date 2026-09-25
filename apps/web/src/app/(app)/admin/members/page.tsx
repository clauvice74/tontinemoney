'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '@/components/action-dialog';
import { UsersList } from '@/components/admin/users-list';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';

/** Suspension / réactivation des membres (super-admin). */
export default function AdminMembersPage() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  return (
    <div>
      <PageHeader title="Membres" description="Suspendre ou réactiver un membre (motif obligatoire, journalisé)." />
      <UsersList
        fixedRole="MEMBER"
        actions={(u) =>
          u.status === 'SUSPENDED' ? (
            <ActionDialog
              trigger="Réactiver"
              title={`Réactiver ${fullName(u)} ?`}
              reason={{ label: 'Motif', required: true }}
              confirmLabel="Réactiver"
              successMessage="Membre réactivé"
              onConfirm={async (reason) => {
                await api.post(`/admin/members/${u.id}/reactivate`, { reason });
                await refresh();
              }}
            />
          ) : (
            <ActionDialog
              trigger="Suspendre"
              title={`Suspendre ${fullName(u)} ?`}
              description="Le membre ne pourra plus effectuer d’opérations."
              reason={{ label: 'Motif', required: true }}
              confirmVariant="destructive"
              confirmLabel="Suspendre"
              successMessage="Membre suspendu"
              onConfirm={async (reason) => {
                await api.post(`/admin/members/${u.id}/suspend`, { reason });
                await refresh();
              }}
            />
          )
        }
      />
    </div>
  );
}
