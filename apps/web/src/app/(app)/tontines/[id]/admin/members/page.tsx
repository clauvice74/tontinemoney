'use client';

import { Button } from '@tontine/ui';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Section } from '@/components/page-header';
import { MembersTable } from '@/components/tontines/members-table';
import { useI18n } from '@/lib/i18n';

/** Membres de la tontine (US-2.3) : recherche, filtres, tri, pagination. */
export default function TontineMembersPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  return (
    <Section
      title={t('adminT.members.title')}
      description={t('adminT.members.description')}
      actions={
        <Button asChild size="sm" variant="secondary">
          <Link href={`/tontines/${id}/admin/members/new`}>
            <UserPlus aria-hidden="true" /> {t('adminT.members.register')}
          </Link>
        </Button>
      }
    >
      <MembersTable tontineId={id} />
    </Section>
  );
}
