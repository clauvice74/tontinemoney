'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { type DepositInput, depositSchema } from '@tontine/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Fieldset,
  FormField,
  Input,
  Stepper,
} from '@tontine/ui';
import { CreditCard, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '@/lib/api';
import type { PaymentView, WalletView } from '@/lib/api/types';
import { emptyToUndefined } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { amountStep, inputToMinor, minorOf, moneyOf, validateAmountPrecision } from '@/lib/money';
import { qk, useCurrentUser } from '@/lib/queries';
import { zodFr } from '@/lib/zod-fr';
import { Amount } from '../amount';
import { PaymentTracker } from './payment-tracker';
import { useFinancialSubmit } from './use-financial-submit';

const depositForm = depositSchema.superRefine((v, ctx) => {
  const msg = validateAmountPrecision(v.amount, v.currency);
  if (msg) ctx.addIssue({ code: 'custom', path: ['amount'], message: msg });
});
type DepositFormInput = z.input<typeof depositForm>;

const STEP_FIELDS = [['amount'], ['method', 'phone']] as const;

function DepositContent({ wallet, onClose }: { wallet: WalletView; onClose: () => void }) {
  const { t } = useI18n();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const defaults = {
    amount: '',
    currency: wallet.currency,
    method: 'MOBILE_MONEY' as const,
    phone: user?.phone ?? '',
  };
  const form = useForm<DepositFormInput, unknown, DepositInput>({
    resolver: zodResolver(depositForm, zodFr),
    defaultValues: defaults,
  });
  const { run, formError } = useFinancialSubmit(form.setError, ['amount', 'phone', 'method']);
  const errors = form.formState.errors;
  const method = form.watch('method');
  const amountMinor = inputToMinor(form.watch('amount'), wallet.currency);
  const steps = [
    t('wallet.depositSteps.amount'),
    t('wallet.depositSteps.method'),
    t('wallet.depositSteps.confirm'),
  ];

  const submit = form.handleSubmit(
    async (values) => {
      const res = await run((key) =>
        api.post<PaymentView>('/me/wallet/deposits', values, { idempotencyKey: key }),
      );
      if (!res) return;
      if (res.method === 'CARD' && res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      setPayment(res);
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
    },
    // Erreur révélée à la confirmation : retour à l'étape du champ concerné.
    (errs) => setStep(errs.amount ? 0 : 1),
  );

  async function next(e: React.FormEvent) {
    e.preventDefault();
    const fields = STEP_FIELDS[step];
    if (fields) {
      if (await form.trigger([...fields], { shouldFocus: true })) setStep(step + 1);
      return;
    }
    await submit();
  }

  if (payment) {
    return (
      <PaymentTracker
        payment={payment}
        kind="deposit"
        onDone={() => {
          setPayment(null);
          setStep(0);
          form.reset(defaults);
        }}
      />
    );
  }

  return (
    <form onSubmit={(e) => void next(e)} className="space-y-5" noValidate>
      <Stepper steps={steps} current={step} label={t('wallet.stepsLabel')} />
      {formError ? <Alert variant="destructive" title={formError} /> : null}

      <div hidden={step !== 0} className="space-y-3">
        <FormField
          id="deposit-amount"
          label={t('wallet.amountIn', { currency: wallet.currency })}
          error={errors.amount?.message}
          required
        >
          <Input
            {...form.register('amount')}
            inputMode="decimal"
            type="number"
            min="0"
            step={amountStep(wallet.currency)}
            autoFocus
          />
        </FormField>
        <p className="text-sm text-muted-foreground">
          {t('wallet.available')} : <Amount value={wallet.available} />
        </p>
      </div>

      <div hidden={step !== 1} className="space-y-4">
        <Fieldset legend={t('wallet.method')} error={errors.method?.message}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['MOBILE_MONEY', Smartphone, t('wallet.mobileMoney'), t('wallet.mobileMoneyHelp')],
                ['CARD', CreditCard, t('wallet.card'), t('wallet.cardHelp')],
              ] as const
            ).map(([value, Icon, title, help]) => (
              <label
                key={value}
                className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
              >
                <input
                  type="radio"
                  value={value}
                  {...form.register('method')}
                  className="mt-0.5 accent-primary"
                />
                <Icon className="size-5 shrink-0 text-info" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-muted-foreground">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </Fieldset>
        {method === 'MOBILE_MONEY' ? (
          <FormField
            id="deposit-phone"
            label={t('wallet.mobileNumber')}
            description={t('wallet.phoneHint')}
            error={errors.phone?.message}
            required
          >
            <Input
              {...form.register('phone', { setValueAs: emptyToUndefined })}
              type="tel"
              autoComplete="tel"
            />
          </FormField>
        ) : (
          <p className="text-sm text-muted-foreground">{t('wallet.cardRedirect')}</p>
        )}
      </div>

      {step === 2 ? (
        <section aria-labelledby="deposit-recap" className="rounded-md bg-muted p-4 text-sm">
          <h3 id="deposit-recap" className="mb-3 font-medium">
            {t('wallet.recap')}
          </h3>
          <dl className="space-y-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.amount')}</dt>
              <dd>
                {amountMinor ? <Amount value={moneyOf(amountMinor, wallet.currency)} /> : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('wallet.method')}</dt>
              <dd className="font-medium">
                {method === 'CARD' ? t('wallet.card') : t('wallet.mobileMoney')}
                {method === 'MOBILE_MONEY' ? ` · ${form.getValues('phone') ?? ''}` : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2">
              <dt className="font-medium">{t('wallet.newBalance')}</dt>
              <dd>
                <Amount
                  value={moneyOf(minorOf(wallet.balance) + (amountMinor ?? 0n), wallet.currency)}
                />
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
        >
          {step === 0 ? t('wallet.cancel') : t('wallet.back')}
        </Button>
        <Button
          type="submit"
          variant={step === 2 ? 'primary' : 'secondary'}
          loading={form.formState.isSubmitting}
        >
          {step === 2 ? t('wallet.confirmDeposit') : t('wallet.next')}
        </Button>
      </div>
    </form>
  );
}

/** Dépôt (US-7.1 / US-7.2) : montant → mode de paiement → confirmation → suivi. */
export function DepositDialog({
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
          <DialogTitle>{t('wallet.depositTitle')}</DialogTitle>
          <DialogDescription>{t('wallet.description')}</DialogDescription>
        </DialogHeader>
        {open ? <DepositContent wallet={wallet} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
