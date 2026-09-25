'use client';

import { IdActionForm } from '@/components/admin/id-action-form';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';

/** Remboursement d'un paiement (US-7.5, super-admin). */
export default function AdminPaymentsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Paiements"
        description="Remboursement d’un paiement terminé, par contre-passation."
      />
      <IdActionForm
        title="Rembourser un paiement"
        description="L’identifiant figure dans le détail du paiement ou de la transaction."
        idLabel="Identifiant du paiement"
        submitLabel="Rembourser"
        successMessage="Remboursement initié"
        destructive
        onSubmit={(id, reason) => api.post(`/admin/payments/${id}/refund`, { reason })}
      />
    </div>
  );
}
