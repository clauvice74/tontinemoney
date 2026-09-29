'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@tontine/ui';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { ActionDialog } from '@/components/action-dialog';
import { UsersList } from '@/components/admin/users-list';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/** Comptes et administrateurs (super-admin) : recherche, filtre par rôle, déverrouillage. */
export default function AdminUsersPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-h1">{t('platform.users.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('platform.users.description')}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/admin/tontine-admins/new">
            <UserPlus aria-hidden="true" /> {t('platform.users.createAdmin')}
          </Link>
        </Button>
      </header>
      <UsersList
        actions={(u) =>
          u.locked ? (
            <ActionDialog
              trigger={t('platform.users.unlock')}
              title={t('platform.users.unlockTitle', { name: fullName(u) })}
              reason={{ label: t('platform.users.reason'), required: true }}
              confirmLabel={t('platform.users.unlock')}
              successMessage={t('platform.users.unlocked')}
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
