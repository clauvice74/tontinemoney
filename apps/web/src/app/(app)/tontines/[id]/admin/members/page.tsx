'use client';

import { Button } from '@tontine/ui';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Section } from '@/components/page-header';
import { MembersTable } from '@/components/tontines/members-table';

export default function TontineMembersPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Section
      title="Membres"
      description="Coordonnées partiellement masquées ; aucune donnée sensible n’est affichée."
      actions={
        <Button asChild size="sm">
          <Link href={`/tontines/${id}/admin/members/new`}>
            <UserPlus aria-hidden="true" /> Inscrire un membre
          </Link>
        </Button>
      }
    >
      <MembersTable tontineId={id} />
    </Section>
  );
}
