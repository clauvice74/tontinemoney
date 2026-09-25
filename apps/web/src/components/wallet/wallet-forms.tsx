'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { zodFr } from '@/lib/zod-fr';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DepositInput,
  type TransferInput,
  type WithdrawalInput,
  depositSchema,
  transferSchema,
  withdrawalSchema,
} from '@tontine/contracts';
import { Alert, Badge, Button, Fieldset, FormField, Input, toast } from '@tontine/ui';
import { CheckCircle2, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { type FieldValues, type UseFormSetError, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { NetworkError } from '@/lib/api/errors';
import type { PaymentView, TransactionView } from '@/lib/api/types';
import { applyServerErrors, emptyToUndefined, formatError } from '@/lib/forms';
import { useIdempotencyKey } from '@/lib/hooks/use-idempotency-key';
import { PAYMENT_STATUS_LABELS, label, statusVariant } from '@/lib/labels';
import { amountStep, formatAmount, validateAmountPrecision } from '@/lib/money';
import { isDev } from '@/lib/navigation';
import { qk } from '@/lib/queries';
import { Money } from '../money';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED']);

/** Ajoute le contrôle de précision selon la devise (0 décimale pour XAF/XOF). */
function checkPrecision(v: { amount: string; currency: string }, ctx: z.RefinementCtx) {
  const msg = validateAmountPrecision(v.amount, v.currency);
  if (msg) ctx.addIssue({ code: 'custom', path: ['amount'], message: msg });
}

const depositForm = depositSchema.superRefine(checkPrecision);
const withdrawalForm = withdrawalSchema.superRefine(checkPrecision);
const transferForm = transferSchema.superRefine(checkPrecision);

/** Soumission d'une opération financière avec clé d'idempotence stable. */
function useFinancialSubmit<TValues extends FieldValues>(
  setError: UseFormSetError<TValues>,
  fields: readonly string[],
) {
  const idem = useIdempotencyKey();
  const [formError, setFormError] = useState<string | null>(null);
  async function run<T>(fn: (key: string) => Promise<T>): Promise<T | undefined> {
    setFormError(null);
    try {
      const res = await fn(idem.key);
      idem.settle();
      return res;
    } catch (e) {
      idem.settle(e);
      setFormError(
        e instanceof NetworkError
          ? `${formatError(e)} Vous pouvez renvoyer la demande sans risque de doublon.`
          : applyServerErrors(e, setError, fields),
      );
      return undefined;
    }
  }
  return { run, formError, idempotencyKey: idem.key };
}

/** Suivi d'un paiement Mobile Money jusqu'à son statut final. */
export function PaymentTracker({ payment, onDone }: { payment: PaymentView; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [simulating, setSimulating] = useState(false);
  const query = useQuery({
    queryKey: ['payments', payment.id],
    queryFn: () => api.get<PaymentView>(`/me/payments/${payment.id}`),
    initialData: payment,
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : 3_000),
  });
  const current = query.data ?? payment;
  const done = TERMINAL.has(current.status);
  const reference = current.reference ?? current.providerReference ?? current.id;

  async function simulate(outcome: 'SUCCESS' | 'FAILURE') {
    setSimulating(true);
    try {
      await api.post(
        `/psp-sim/mobile-money/${encodeURIComponent(reference)}/confirm`,
        { outcome },
        { auth: false },
      );
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: qk.wallet });
      await queryClient.invalidateQueries({ queryKey: ['wallet-movements'] });
    } catch (e) {
      toast.error('Simulation impossible', formatError(e));
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        {done && current.status === 'COMPLETED' ? (
          <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
        ) : (
          <Smartphone className="size-5 text-primary" aria-hidden="true" />
        )}
        <p className="font-medium">
          Paiement de <Money value={current.amount} />
        </p>
        <Badge variant={statusVariant(current.status)}>
          {label(PAYMENT_STATUS_LABELS, current.status)}
        </Badge>
      </div>
      {!done ? (
        <p className="text-sm text-muted-foreground">
          Confirmez l’opération sur votre téléphone (demande USSD envoyée). Le statut se met à jour
          automatiquement.
        </p>
      ) : current.status === 'COMPLETED' ? (
        <p className="text-sm">Votre portefeuille a été crédité.</p>
      ) : (
        <p className="text-sm text-destructive">Le paiement n’a pas abouti.</p>
      )}
      {!done && isDev ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void simulate('SUCCESS')}
            loading={simulating}
          >
            Simuler la confirmation USSD
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void simulate('FAILURE')}
            disabled={simulating}
          >
            Simuler un refus
          </Button>
        </div>
      ) : null}
      {done && onDone ? (
        <Button size="sm" variant="outline" onClick={onDone}>
          Nouvelle opération
        </Button>
      ) : null}
    </div>
  );
}

type DepositFormInput = z.input<typeof depositForm>;

export function DepositForm({ currency }: { currency: string }) {
  const queryClient = useQueryClient();
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const form = useForm<DepositFormInput, unknown, DepositInput>({
    resolver: zodResolver(depositForm, zodFr),
    defaultValues: { amount: '', currency, method: 'MOBILE_MONEY', phone: '' },
  });
  const { run, formError } = useFinancialSubmit(form.setError, ['amount', 'phone', 'method']);
  const method = form.watch('method');
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
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
  });

  if (payment) {
    return (
      <PaymentTracker
        payment={payment}
        onDone={() => {
          setPayment(null);
          form.reset({ amount: '', currency, method: 'MOBILE_MONEY', phone: '' });
        }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField
        id="deposit-amount"
        label={`Montant (${currency})`}
        error={errors.amount?.message}
        required
      >
        <Input
          {...form.register('amount')}
          inputMode="decimal"
          type="number"
          min="0"
          step={amountStep(currency)}
        />
      </FormField>
      <Fieldset legend="Moyen de paiement">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              value="MOBILE_MONEY"
              {...form.register('method')}
              className="accent-primary"
            />
            Mobile Money
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              value="CARD"
              {...form.register('method')}
              className="accent-primary"
            />
            Carte bancaire (3-D Secure)
          </label>
        </div>
      </Fieldset>
      {method === 'MOBILE_MONEY' ? (
        <FormField
          id="deposit-phone"
          label="Numéro Mobile Money"
          description="Format international, ex. +237 6 99 12 34 56"
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
        <p className="text-sm text-muted-foreground">
          Vous serez redirigé vers la page sécurisée de paiement par carte.
        </p>
      )}
      <Button type="submit" loading={form.formState.isSubmitting}>
        Déposer
      </Button>
    </form>
  );
}

type WithdrawalFormInput = z.input<typeof withdrawalForm>;

export function WithdrawalForm({ currency }: { currency: string }) {
  const queryClient = useQueryClient();
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const form = useForm<WithdrawalFormInput, unknown, WithdrawalInput>({
    resolver: zodResolver(withdrawalForm, zodFr),
    defaultValues: { amount: '', currency, method: 'MOBILE_MONEY', phone: '' },
  });
  const { run, formError } = useFinancialSubmit(form.setError, ['amount', 'phone']);
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    const res = await run((key) =>
      api.post<PaymentView>('/me/wallet/withdrawals', values, { idempotencyKey: key }),
    );
    if (!res) return;
    toast.success(
      'Retrait initié',
      `${formatAmount(values.amount, values.currency)} vers ${values.phone}`,
    );
    setPayment(res);
    void queryClient.invalidateQueries({ queryKey: qk.wallet });
  });

  if (payment) {
    return (
      <PaymentTracker
        payment={payment}
        onDone={() => {
          setPayment(null);
          form.reset({ amount: '', currency, method: 'MOBILE_MONEY', phone: '' });
        }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField
        id="withdraw-amount"
        label={`Montant (${currency})`}
        error={errors.amount?.message}
        required
      >
        <Input
          {...form.register('amount')}
          inputMode="decimal"
          type="number"
          min="0"
          step={amountStep(currency)}
        />
      </FormField>
      <FormField
        id="withdraw-phone"
        label="Numéro Mobile Money bénéficiaire"
        error={errors.phone?.message}
        required
      >
        <Input {...form.register('phone')} type="tel" autoComplete="tel" />
      </FormField>
      <Button type="submit" loading={form.formState.isSubmitting}>
        Retirer
      </Button>
    </form>
  );
}

type TransferFormInput = z.input<typeof transferForm>;

export function TransferForm({ currency }: { currency: string }) {
  const queryClient = useQueryClient();
  const [done, setDone] = useState<TransactionView | null>(null);
  const form = useForm<TransferFormInput, unknown, TransferInput>({
    resolver: zodResolver(transferForm, zodFr),
    defaultValues: { toIdentifier: '', amount: '', currency, note: undefined },
  });
  const { run, formError } = useFinancialSubmit(form.setError, ['toIdentifier', 'amount', 'note']);
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    const res = await run((key) =>
      api.post<TransactionView>('/me/wallet/transfers', values, { idempotencyKey: key }),
    );
    if (!res) return;
    toast.success('Transfert effectué', formatAmount(values.amount, values.currency));
    setDone(res);
    form.reset({ toIdentifier: '', amount: '', currency, note: undefined });
    void queryClient.invalidateQueries({ queryKey: qk.wallet });
    void queryClient.invalidateQueries({ queryKey: ['wallet-movements'] });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {done ? (
        <Alert variant="success" title="Transfert effectué">
          Montant : <Money value={done.amount} />
        </Alert>
      ) : null}
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField
        id="transfer-to"
        label="Destinataire"
        description="Email ou téléphone d’un membre TontineMoney"
        error={errors.toIdentifier?.message ?? errors.root?.message}
        required
      >
        <Input {...form.register('toIdentifier')} />
      </FormField>
      <FormField
        id="transfer-amount"
        label={`Montant (${currency})`}
        error={errors.amount?.message}
        required
      >
        <Input
          {...form.register('amount')}
          inputMode="decimal"
          type="number"
          min="0"
          step={amountStep(currency)}
        />
      </FormField>
      <FormField id="transfer-note" label="Message (facultatif)" error={errors.note?.message}>
        <Input {...form.register('note', { setValueAs: emptyToUndefined })} maxLength={140} />
      </FormField>
      <Button type="submit" loading={form.formState.isSubmitting}>
        Transférer
      </Button>
    </form>
  );
}
