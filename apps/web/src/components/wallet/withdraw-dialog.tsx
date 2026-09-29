'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { type WithdrawalRequestInput, withdrawalRequestSchema } from '@tontine/contracts';
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
  OtpInput,
  Stepper,
} from '@tontine/ui';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { ApiError, NetworkError } from '@/lib/api/errors';
import type { PaymentView, WalletView } from '@/lib/api/types';
import { applyServerErrors, formatError } from '@/lib/forms';
import { useIdempotencyKey } from '@/lib/hooks/use-idempotency-key';
import { useI18n } from '@/lib/i18n';
import { kycAtLeast } from '@/lib/kyc';
import { amountStep, inputToMinor, minorOf, moneyOf, validateAmountPrecision } from '@/lib/money';
import { qk, useCurrentUser } from '@/lib/queries';
import { zodFr } from '@/lib/zod-fr';
import { Amount } from '../amount';
import { PaymentTracker } from './payment-tracker';

const requestForm = withdrawalRequestSchema.superRefine((v, ctx) => {
  const msg = validateAmountPrecision(v.amount, v.currency);
  if (msg) ctx.addIssue({ code: 'custom', path: ['amount'], message: msg });
});
type RequestFormInput = z.input<typeof requestForm>;

interface Challenge {
  challengeId: string;
  channel: 'SMS' | 'EMAIL';
  destination: string;
  expiresAt: string;
}

/** Secondes restantes avant une date ISO, rafraîchies chaque seconde. */
function useSecondsLeft(iso: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : 0;
}

function WithdrawContent({ wallet, onClose }: { wallet: WalletView; onClose: () => void }) {
  const { t } = useI18n();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [values, setValues] = useState<WithdrawalRequestInput | null>(null);
  const [otp, setOtp] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resending, setResending] = useState(false);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const secondsLeft = useSecondsLeft(challenge?.expiresAt ?? null);
  const defaults = {
    amount: '',
    currency: wallet.currency,
    method: 'MOBILE_MONEY' as const,
    phone: user?.phone ?? '',
  };
  const form = useForm<RequestFormInput, unknown, WithdrawalRequestInput>({
    resolver: zodResolver(requestForm, zodFr),
    defaultValues: defaults,
  });
  const errors = form.formState.errors;
  const amountMinor = inputToMinor(form.watch('amount'), wallet.currency);
  const availableAfter = amountMinor !== null ? minorOf(wallet.available) - amountMinor : null;
  const insufficient = availableAfter !== null && availableAfter < 0n;
  const step = payment ? 2 : challenge ? 1 : 0;
  const steps = [
    t('wallet.withdrawSteps.amount'),
    t('wallet.withdrawSteps.code'),
    t('wallet.withdrawSteps.done'),
  ];

  async function sendCode(v: WithdrawalRequestInput) {
    const c = await api.post<Challenge>('/me/wallet/withdrawals/otp', v);
    setValues(v);
    setChallenge(c);
    setOtp('');
    setCodeError(null);
  }

  const requestCode = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await sendCode(v);
    } catch (e) {
      setFormError(applyServerErrors(e, form.setError, ['amount', 'phone']) ?? null);
    }
  });

  async function resend() {
    if (!values) return;
    setResending(true);
    try {
      await sendCode(values);
    } catch (e) {
      setCodeError(codeMessage(e));
    } finally {
      setResending(false);
    }
  }

  function codeMessage(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.code === 'INVALID_OTP') return t('wallet.otpInvalid');
      if (e.code === 'OTP_EXPIRED') return t('wallet.otpExpired');
      if (e.code === 'OTP_LOCKED') return t('wallet.otpLocked');
    }
    return e instanceof NetworkError
      ? `${formatError(e)} ${t('wallet.retrySafe')}`
      : formatError(e);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge || !values) return;
    if (!/^\d{6}$/.test(otp)) {
      setCodeError(t('wallet.codeIncomplete'));
      return;
    }
    setConfirming(true);
    setCodeError(null);
    try {
      const res = await api.post<PaymentView>(
        '/me/wallet/withdrawals',
        { ...values, otpChallengeId: challenge.challengeId, otp },
        { idempotencyKey: idem.key },
      );
      idem.settle();
      setPayment(res);
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      void queryClient.invalidateQueries({ queryKey: ['wallet-movements'] });
    } catch (err) {
      idem.settle(err);
      if (err instanceof ApiError && err.code === 'INVALID_OTP') setOtp('');
      setCodeError(codeMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  if (payment) {
    return (
      <div className="space-y-5">
        <Stepper steps={steps} current={2} label={t('wallet.stepsLabel')} />
        <PaymentTracker payment={payment} kind="withdrawal" onDone={onClose} />
      </div>
    );
  }

  if (!user || !kycAtLeast(user.kycLevel, 'TIER_2')) {
    return (
      <Alert variant="warning" title={t('wallet.kycRequired')}>
        <Button asChild size="sm" variant="secondary" className="mt-2">
          <Link href="/kyc">{t('wallet.kycCta')}</Link>
        </Button>
      </Alert>
    );
  }

  if (challenge && values) {
    const minutes = Math.floor(secondsLeft / 60);
    const seconds = String(secondsLeft % 60).padStart(2, '0');
    return (
      <form onSubmit={(e) => void confirm(e)} className="space-y-5" noValidate>
        <Stepper steps={steps} current={step} label={t('wallet.stepsLabel')} />
        <div className="flex gap-3 rounded-md bg-secondary p-4 text-sm">
          <ShieldCheck className="size-5 shrink-0 text-info" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{t('wallet.codeTitle')}</p>
            <p>
              {t('wallet.codeSent', {
                channel: challenge.channel === 'SMS' ? t('wallet.sms') : t('wallet.email'),
                destination: challenge.destination,
              })}
            </p>
          </div>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('wallet.amount')}</dt>
            <dd>
              <Amount
                value={moneyOf(inputToMinor(values.amount, wallet.currency) ?? 0n, wallet.currency)}
                signed="out"
              />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('wallet.destination')}</dt>
            <dd className="font-medium">{values.phone}</dd>
          </div>
        </dl>
        {codeError ? <Alert variant="destructive" title={codeError} /> : null}
        <FormField id="withdraw-otp" label={t('wallet.code')} required>
          <OtpInput value={otp} onValueChange={setOtp} autoFocus />
        </FormField>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {secondsLeft > 0
            ? t('wallet.expiresIn', { time: `${minutes}:${seconds}` })
            : t('wallet.codeExpired')}{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            loading={resending}
            onClick={() => void resend()}
          >
            {t('wallet.resend')}
          </Button>
        </p>
        <Alert variant="warning" title={t('wallet.withdrawIrreversible')} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setChallenge(null);
              setCodeError(null);
            }}
          >
            {t('wallet.back')}
          </Button>
          <Button type="submit" variant="primary" loading={confirming} disabled={secondsLeft === 0}>
            {t('wallet.confirmWithdraw')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void requestCode(e)} className="space-y-5" noValidate>
      <Stepper steps={steps} current={step} label={t('wallet.stepsLabel')} />
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField
        id="withdraw-amount"
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
          autoFocus
        />
      </FormField>
      <FormField
        id="withdraw-phone"
        label={t('wallet.destination')}
        description={t('wallet.destinationHint')}
        error={errors.phone?.message}
        required
      >
        <Input {...form.register('phone')} type="tel" autoComplete="tel" />
      </FormField>
      <dl className="space-y-2 rounded-md bg-muted p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('wallet.available')}</dt>
          <dd>
            <Amount value={wallet.available} />
          </dd>
        </div>
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
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('wallet.cancel')}
        </Button>
        <Button
          type="submit"
          variant="secondary"
          loading={form.formState.isSubmitting}
          disabled={insufficient}
        >
          {t('wallet.getCode')}
        </Button>
      </div>
    </form>
  );
}

/** Retrait (US-7.3, A-59) : montant et numéro → code de sécurité → suivi du versement. */
export function WithdrawDialog({
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
          <DialogTitle>{t('wallet.withdrawTitle')}</DialogTitle>
          <DialogDescription>{t('wallet.destinationHint')}</DialogDescription>
        </DialogHeader>
        {open ? <WithdrawContent wallet={wallet} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
