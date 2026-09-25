'use client';

import { IdActionForm } from '@/components/admin/id-action-form';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';

/** Signalement de fraude (A-14) : suspend le membre et déclenche une revue. */
export default function AdminFraudPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Signalement de fraude" description="Le membre signalé est suspendu et placé en revue de conformité." />
      <IdActionForm
        title="Signaler un membre"
        idLabel="Identifiant du membre"
        submitLabel="Signaler"
        successMessage="Signalement enregistré"
        destructive
        onSubmit={(memberId, reason) => api.post('/admin/fraud/flag', { memberId, reason })}
      />
    </div>
  );
}
