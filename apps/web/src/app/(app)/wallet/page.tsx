'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingBlock,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tontine/ui';
import { Lock, Wallet } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { QueryState } from '@/components/feedback';
import { PageHeader, StatCard } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { MovementsTable } from '@/components/wallet/movements-table';
import { DepositForm, TransferForm, WithdrawalForm } from '@/components/wallet/wallet-forms';
import { formatMoneyView } from '@/lib/money';
import { useWallet } from '@/lib/queries';

const WALLET_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  LOCKED: 'Verrouillé',
  CLOSED: 'Clôturé',
};

function WalletContent() {
  const wallet = useWallet();
  const params = useSearchParams();
  const action = params.get('action');
  const initialTab =
    action === 'withdraw' || action === 'transfer' || action === 'deposit' ? action : 'deposit';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portefeuille"
        description="Solde, dépôts, retraits, transferts et historique de vos mouvements."
      />
      <QueryState query={wallet} loading={<LoadingBlock lines={4} />}>
        {(w) => (
          <>
            <section aria-label="Soldes" className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Solde total"
                value={formatMoneyView(w.balance)}
                icon={<Wallet />}
                hint={<StatusBadge status={w.status} labels={WALLET_STATUS_LABELS} />}
              />
              <StatCard label="Disponible" value={formatMoneyView(w.available)} />
              <StatCard
                label="Bloqué"
                value={formatMoneyView(w.blocked)}
                icon={<Lock />}
                hint="Fonds réservés (cotisations, retraits en cours)"
              />
            </section>
            <Card>
              <CardHeader>
                <CardTitle>Opérations</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={initialTab}>
                  <TabsList>
                    <TabsTrigger value="deposit">Déposer</TabsTrigger>
                    <TabsTrigger value="withdraw">Retirer</TabsTrigger>
                    <TabsTrigger value="transfer">Transférer</TabsTrigger>
                  </TabsList>
                  <TabsContent value="deposit" className="max-w-md">
                    <DepositForm currency={w.currency} />
                  </TabsContent>
                  <TabsContent value="withdraw" className="max-w-md">
                    <WithdrawalForm currency={w.currency} />
                  </TabsContent>
                  <TabsContent value="transfer" className="max-w-md">
                    <TransferForm currency={w.currency} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </QueryState>
      <Card>
        <CardHeader>
          <CardTitle>Historique</CardTitle>
        </CardHeader>
        <CardContent>
          <MovementsTable />
        </CardContent>
      </Card>
    </div>
  );
}

export default function WalletPage() {
  return (
    <Suspense>
      <WalletContent />
    </Suspense>
  );
}
