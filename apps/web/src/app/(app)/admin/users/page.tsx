'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '@/components/action-dialog';
import { UsersList } from '@/components/admin/users-list';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  return (
    <div>
      <PageHeader title="Utilisateurs" description="Recherche de comptes et déverrouillage." />
      <UsersList
        actions={(u) =>
          u.locked ? (
            <ActionDialog
              trigger="Déverrouiller"
              title={`Déverrouiller le compte de ${fullName(u)} ?`}
              reason={{ label: 'Motif', required: true }}
              confirmLabel="Déverrouiller"
              successMessage="Compte déverrouillé"
              onConfirm={async (reason) => {
                await api.post(`/admin/users/${u.id}/unlock`, { reason });
                await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
              }}
            />
          ) : null
        }
      />
    </div>
  );
}
