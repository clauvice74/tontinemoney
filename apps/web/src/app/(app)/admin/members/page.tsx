'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '@/components/action-dialog';
import { UsersList } from '@/components/admin/users-list';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/** Suspension / réactivation des membres (super-admin, motif obligatoire, journalisé). */
export default function AdminMembersPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h1">{t('platform.members.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('platform.members.description')}</p>
      </div>
      <UsersList
        fixedRole="MEMBER"
        actions={(u) =>
          u.status === 'SUSPENDED' ? (
            <ActionDialog
              trigger={t('platform.members.reactivate')}
              title={t('platform.members.reactivateTitle', { name: fullName(u) })}
              reason={{ label: t('platform.users.reason'), required: true }}
              confirmLabel={t('platform.members.reactivate')}
              successMessage={t('platform.members.reactivated')}
              onConfirm={async (reason) => {
                await api.post(`/admin/members/${u.id}/reactivate`, { reason });
                await refresh();
              }}
            />
          ) : (
            <ActionDialog
              trigger={t('platform.members.suspend')}
              title={t('platform.members.suspendTitle', { name: fullName(u) })}
              description={t('platform.members.suspendBody')}
              reason={{ label: t('platform.users.reason'), required: true }}
              confirmVariant="destructive"
              confirmLabel={t('platform.members.suspend')}
              successMessage={t('platform.members.suspended')}
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
