'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { type TransferInput, transferSchema } from '@tontine/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from '@tontine/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '@/lib/api';
import type { TransactionView, WalletView } from '@/lib/api/types';
import { emptyToUndefined } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { amountStep, inputToMinor, minorOf, moneyOf, validateAmountPrecision } from '@/lib/money';
import { qk } from '@/lib/queries';
import { zodFr } from '@/lib/zod-fr';
import { Amount } from '../amount';
import { useFinancialSubmit } from './use-financial-submit';

const transferForm = transferSchema.superRefine((v, ctx) => {
  const msg = validateAmountPrecision(v.amount, v.currency);
  if (msg) ctx.addIssue({ code: 'custom', path: ['amount'], message: msg });
});
type TransferFormInput = z.input<typeof transferForm>;

function TransferContent({ wallet, onClose }: { wallet: WalletView; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<TransactionView | null>(null);
  const defaults = { toIdentifier: '', amount: '', currency: wallet.currency, note: undefined };
  const form = useForm<TransferFormInput, unknown, TransferInput>({
    resolver: zodResolver(transferForm, zodFr),
    defaultValues: defaults,
  });
  const { run, formError } = useFinancialSubmit(form.setError, ['toIdentifier', 'amount', 'note']);
  const errors = form.formState.errors;
  const amountMinor = inputToMinor(form.watch('amount'), wallet.currency);
  const availableAfter = amountMinor !== null ? minorOf(wallet.available) - amountMinor : null;
  const insufficient = availableAfter !== null && availableAfter < 0n;

  const submit = form.handleSubmit(async (values) => {
    // Première validation : récapitulatif ; la seconde envoie (transfert irréversible).
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const res = await run((key) =>
      api.post<TransactionView>('/me/wallet/transfers', values, { idempotencyKey: key }),
    );
    if (!res) {
      setConfirming(false);
      return;
    }
    setDone(res);
    void queryClient.invalidateQueries({ queryKey: qk.wallet });
    void queryClient.invalidateQueries({ queryKey: ['wallet-movements'] });
  });

  if (done) {
    return (
      <div className="space-y-4">
        <Alert variant="success" title={t('wallet.transferDone')}>
          <Amount value={done.amount} />
        </Alert>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('wallet.close')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <div hidden={confirming} className="space-y-4">
        <FormField
          id="transfer-to"
          label={t('wallet.recipient')}
          description={t('wallet.recipientHint')}
          error={errors.toIdentifier?.message ?? errors.root?.message}
          required
        >
          <Input {...form.register('toIdentifier')} autoComplete="off" />
        </FormField>
        <FormField
          id="transfer-amount"
          label={t('wallet.amountIn', { currency: wallet.currency })}
          error={errors.amount?.message ?? (insufficient ? t('wallet.insufficient') : undefined)}
          required
        >
          <Input
            {...form.register('amount')}
            inputMode="decimal"
            type="number"
            min="0"
            step={amountStep(wallet.currency)}
          />
        </FormField>
        <FormField id="transfer-note" label={t('wallet.note')} error={errors.note?.message}>
          <Input {...form.register('note', { setValueAs: emptyToUndefined })} maxLength={140} />
        </FormField>
      </div>
      <dl className="space-y-2 rounded-md bg-muted p-4 text-sm">
        {confirming ? (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.recipient')}</dt>
              <dd className="font-medium">{form.getValues('toIdentifier')}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.amount')}</dt>
              <dd>
                {amountMinor ? (
                  <Amount value={moneyOf(amountMinor, wallet.currency)} signed="out" />
                ) : null}
              </dd>
            </div>
          </>
        ) : (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('wallet.available')}</dt>
            <dd>
              <Amount value={wallet.available} />
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t pt-2">
          <dt className="font-medium">{t('wallet.availableAfter')}</dt>
          <dd className={insufficient ? 'text-destructive' : undefined}>
            {availableAfter !== null ? (
              <Amount value={moneyOf(availableAfter, wallet.currency)} />
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (confirming ? setConfirming(false) : onClose())}
        >
          {confirming ? t('wallet.back') : t('wallet.cancel')}
        </Button>
        <Button
          type="submit"
          variant={confirming ? 'primary' : 'secondary'}
          loading={form.formState.isSubmitting}
          disabled={insufficient}
        >
          {confirming ? t('wallet.confirmTransfer') : t('wallet.next')}
        </Button>
      </div>
    </form>
  );
}

/** Transfert entre membres (US-6.x) : saisie → récapitulatif → confirmation. */
export function TransferDialog({
  wallet,
  open,
  onOpenChange,
}: {
  wallet: WalletView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wallet.transferTitle')}</DialogTitle>
          <DialogDescription>{t('wallet.recipientHint')}</DialogDescription>
        </DialogHeader>
        {open ? <TransferContent wallet={wallet} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
