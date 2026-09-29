'use client';

import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@tontine/ui';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Lock } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Amount } from '@/components/amount';
import { QueryState } from '@/components/feedback';
import { StatusBadge } from '@/components/status-badge';
import { DepositDialog } from '@/components/wallet/deposit-dialog';
import { MovementsList } from '@/components/wallet/movements-list';
import { TransferDialog } from '@/components/wallet/transfer-dialog';
import { WithdrawDialog } from '@/components/wallet/withdraw-dialog';
import { useI18n } from '@/lib/i18n';
import { useLabels } from '@/lib/i18n/labels';
import { useWallet } from '@/lib/queries';

type Action = 'deposit' | 'withdraw' | 'transfer';
const ACTIONS: readonly string[] = ['deposit', 'withdraw', 'transfer'];

function WalletContent() {
  const { t } = useI18n();
  const labels = useLabels();
  const wallet = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // L'opération ouverte est portée par l'URL (?action=deposit) : lien direct depuis l'accueil
  // ou le paiement d'une contribution, et retour arrière qui ferme la fenêtre.
  const raw = params.get('action');
  const action = raw && ACTIONS.includes(raw) ? (raw as Action) : null;
  const open = (a: Action | null) =>
    router.replace(a ? `${pathname}?action=${a}` : pathname, { scroll: false });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h1">{t('wallet.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('wallet.description')}</p>
      </div>

      <QueryState query={wallet}>
        {(w) => {
          const operational = w.status === 'ACTIVE';
          return (
            <>
              <section
                aria-labelledby="wallet-balance"
                className="rounded-lg bg-nav p-5 text-nav-foreground shadow-sm sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="wallet-balance" className="text-sm font-medium">
                    {t('wallet.total')}
                  </h2>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="sr-only">{t('wallet.statusLabel')} :</span>
                    <StatusBadge status={w.status} labels={labels.walletStatus} />
                  </span>
                </div>
                <p className="mt-3">
                  <Amount value={w.balance} size="h1" onNavy />
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-nav-hover pt-4">
                  <div>
                    <dt className="text-xs">{t('wallet.available')}</dt>
                    <dd className="mt-0.5">
                      <Amount value={w.available} size="h3" onNavy />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-xs">
                      <Lock className="size-3" aria-hidden="true" /> {t('wallet.blocked')}
                    </dt>
                    <dd className="mt-0.5">
                      <Amount value={w.blocked} size="h3" onNavy />
                      <span className="mt-1 block text-xs text-gold-pale">
                        {t('wallet.blockedHelp')}
                      </span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!operational}
                    onClick={() => open('deposit')}
                  >
                    <ArrowDownLeft aria-hidden="true" /> {t('wallet.deposit')}
                  </Button>
                  <button
                    type="button"
                    disabled={!operational}
                    onClick={() => open('withdraw')}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-nav-foreground px-4 text-sm font-medium text-gold-pale transition-colors hover:bg-nav-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-ring disabled:opacity-50"
                  >
                    <ArrowUpRight className="size-4" aria-hidden="true" /> {t('wallet.withdraw')}
                  </button>
                  <button
                    type="button"
                    disabled={!operational}
                    onClick={() => open('transfer')}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-gold-pale underline-offset-4 transition-colors hover:bg-nav-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-ring disabled:opacity-50"
                  >
                    <ArrowLeftRight className="size-4" aria-hidden="true" /> {t('wallet.transfer')}
                  </button>
                </div>
              </section>
              {!operational ? <Alert variant="warning" title={t('wallet.notOperational')} /> : null}
              <DepositDialog
                wallet={w}
                open={operational && action === 'deposit'}
                onOpenChange={(o) => open(o ? 'deposit' : null)}
              />
              <WithdrawDialog
                wallet={w}
                open={operational && action === 'withdraw'}
                onOpenChange={(o) => open(o ? 'withdraw' : null)}
              />
              <TransferDialog
                wallet={w}
                open={operational && action === 'transfer'}
                onOpenChange={(o) => open(o ? 'transfer' : null)}
              />
            </>
          );
        }}
      </QueryState>

      <Card>
        <CardHeader>
          <CardTitle>{t('wallet.historyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <MovementsList />
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
