'use client';

import { useParams } from 'next/navigation';
import { AccessRequests } from '@/components/access-requests';
import { Section } from '@/components/page-header';

export default function TontineAccessRequestsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Section
      title="Demandes d’accès"
      description="Acceptez ou refusez (motif obligatoire) les demandes d’adhésion à cette tontine."
    >
      <AccessRequests tontineId={id} />
    </Section>
  );
}
