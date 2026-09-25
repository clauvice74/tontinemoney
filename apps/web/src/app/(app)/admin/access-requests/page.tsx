'use client';

import { AccessRequests } from '@/components/access-requests';
import { PageHeader } from '@/components/page-header';

export default function AdminAccessRequestsPage() {
  return (
    <div>
      <PageHeader
        title="Demandes d’accès"
        description="Demandes de compte et d’administration de tontine (US-10.1)."
      />
      <AccessRequests />
    </div>
  );
}
