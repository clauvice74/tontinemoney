'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, toast } from '@tontine/ui';
import { CheckCircle2, Smartphone, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { PaymentView } from '@/lib/api/types';
import { formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { useLabels } from '@/lib/i18n/labels';
import { simulatorsEnabled } from '@/lib/navigation';
import { qk } from '@/lib/queries';
import { Amount } from '../amount';
import { StatusBadge } from '../status-badge';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED']);

/**
 * Suivi d'un dépôt ou d'un retrait jusqu'à son statut final (US-7.4) : rafraîchissement toutes
 * les 3 s, puis mise à jour du solde et de l'historique.
 */
export function PaymentTracker({
  payment,
  kind,
  onDone,
}: {
  payment: PaymentView;
  kind: 'deposit' | 'withdrawal';
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const labels = useLabels();
  const queryClient = useQueryClient();
  const [simulating, setSimulating] = useState(false);
  const query = useQuery({
    queryKey: ['payments', payment.id],
    queryFn: async () => {
      const p = await api.get<PaymentView>(`/me/payments/${payment.id}`);
      if (TERMINAL.has(p.status)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.wallet }),
          queryClient.invalidateQueries({ queryKey: ['wallet-movements'] }),
        ]);
      }
      return p;
    },
    initialData: payment,
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : 3_000),
  });
  const current = query.data ?? payment;
  const done = TERMINAL.has(current.status);
  const ok = current.status === 'COMPLETED';
  const reference = current.reference ?? current.providerReference ?? current.id;

  async function simulate(outcome: 'SUCCESS' | 'FAILURE') {
    setSimulating(true);
    try {
      // Simulateur de démonstration : réservé au membre concerné (contrôle côté API)
      await api.post(`/psp-sim/mobile-money/${encodeURIComponent(reference)}/confirm`, { outcome });
      await query.refetch();
    } catch (e) {
      toast.error(t('wallet.tracker.simulateFailed'), formatError(e));
    } finally {
      setSimulating(false);
    }
  }

  const Icon = !done ? Smartphone : ok ? CheckCircle2 : XCircle;
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex items-start gap-3 rounded-lg border p-4">
        <Icon
          className={
            !done ? 'size-6 text-info' : ok ? 'size-6 text-success' : 'size-6 text-destructive'
          }
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {kind === 'deposit' ? t('wallet.tracker.payment') : t('wallet.tracker.withdrawal')}{' '}
              <Amount value={current.amount} />
            </p>
            <StatusBadge status={current.status} labels={labels.paymentStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {!done
              ? kind === 'deposit'
                ? t('wallet.tracker.pendingDeposit')
                : t('wallet.tracker.pendingWithdrawal')
              : ok
                ? kind === 'deposit'
                  ? t('wallet.tracker.credited')
                  : t('wallet.tracker.paidOut')
                : t('wallet.tracker.failed')}
          </p>
        </div>
      </div>
      {!done && kind === 'deposit' && simulatorsEnabled ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void simulate('SUCCESS')}
            loading={simulating}
          >
            {t('wallet.tracker.simulateOk')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void simulate('FAILURE')}
            disabled={simulating}
          >
            {t('wallet.tracker.simulateKo')}
          </Button>
        </div>
      ) : null}
      {onDone ? (
        <div className="flex justify-end">
          <Button variant={done ? 'secondary' : 'ghost'} onClick={onDone}>
            {done ? t('wallet.newOperation') : t('wallet.close')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
