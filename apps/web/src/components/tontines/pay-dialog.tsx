'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  type ButtonProps,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  LoadingBlock,
  toast,
} from '@tontine/ui';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import { NetworkError } from '@/lib/api/errors';
import type { MoneyView } from '@/lib/api/types';
import { formatError } from '@/lib/forms';
import { useIdempotencyKey } from '@/lib/hooks/use-idempotency-key';
import { useI18n } from '@/lib/i18n';
import { qk, useWallet } from '@/lib/queries';
import { Amount } from '../amount';

function minorOf(m: MoneyView): bigint {
  return BigInt(m.amountMinor ?? '0');
}

/**
 * Contenu monté à l'ouverture : la clé d'idempotence est générée à ce moment-là et réutilisée
 * si l'utilisateur renvoie après une erreur réseau. Solde disponible, montant et solde après
 * paiement sont affichés avant toute confirmation (charte UX : « solde avant paiement »).
 */
function PayContent({
  path,
  amount,
  summary,
  onDone,
  successMessage,
}: {
  path: string;
  amount: MoneyView;
  summary: ReactNode;
  onDone: () => void;
  successMessage: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const idem = useIdempotencyKey();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function pay() {
    setPending(true);
    setError(null);
    try {
      await api.post(path, {}, { idempotencyKey: idem.key });
      idem.settle();
      toast.success(successMessage);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.wallet }),
        queryClient.invalidateQueries({ queryKey: qk.tontines }),
        queryClient.invalidateQueries({ queryKey: ['me', 'contributions'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet-movements'] }),
      ]);
      onDone();
    } catch (e) {
      idem.settle(e);
      setError(
        e instanceof NetworkError ? `${formatError(e)} ${t('pay.retrySafe')}` : formatError(e),
      );
    } finally {
      setPending(false);
    }
  }

  const available = wallet.data?.available;
  const after =
    available && available.currency === amount.currency
      ? minorOf(available) - minorOf(amount)
      : null;
  const insufficient = after !== null && after < 0n;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('pay.title')}</DialogTitle>
        <DialogDescription>{t('pay.description')}</DialogDescription>
      </DialogHeader>
      <div className="rounded-md bg-muted p-4 text-sm">{summary}</div>
      {wallet.isPending ? (
        <LoadingBlock />
      ) : (
        <dl className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{t('pay.available')}</dt>
            <dd>
              <Amount value={available} />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{t('pay.amount')}</dt>
            <dd>
              <Amount value={amount} signed="out" />
            </dd>
          </div>
          {after !== null ? (
            <div className="flex items-baseline justify-between gap-3 border-t pt-2">
              <dt className="font-medium">{t('pay.after')}</dt>
              <dd className={insufficient ? 'text-destructive' : undefined}>
                <Amount
                  value={{
                    amount: '',
                    amountMinor: after.toString(),
                    currency: amount.currency,
                  }}
                />
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      {insufficient ? (
        <Alert variant="warning" title={t('pay.insufficient')}>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link href="/wallet?action=deposit">{t('pay.addMoney')}</Link>
          </Button>
        </Alert>
      ) : null}
      {error ? <Alert variant="destructive" title={error} /> : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          {t('pay.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => void pay()}
          loading={pending}
          disabled={insufficient}
        >
          {t('pay.confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Paiement depuis le wallet (contribution, droit d'entrée) — POST financier idempotent. */
export function PayDialog({
  label,
  path,
  amount,
  summary,
  successMessage,
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  label: string;
  path: string;
  amount: MoneyView;
  summary: ReactNode;
  successMessage: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {open ? (
          <PayContent
            path={path}
            amount={amount}
            summary={summary}
            successMessage={successMessage}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
