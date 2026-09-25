'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CURRENCY_CODES,
  type CreateTontineInput,
  DRAW_MODES,
  INCOMPLETE_POLICIES,
  TONTINE_FREQUENCIES,
  WEEKDAY_VALUES,
  createTontineSchema,
} from '@tontine/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Fieldset,
  FormField,
  Input,
  Select,
} from '@tontine/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { applyServerErrors, emptyToUndefined } from '@/lib/forms';
import { isoDateFromToday } from '@/lib/format';
import {
  DRAW_MODE_LABELS,
  FREQUENCY_LABELS,
  INCOMPLETE_POLICY_LABELS,
  WEEKDAY_LABELS,
  WEEK_OF_MONTH_LABELS,
} from '@/lib/labels';
import { amountStep, validateAmountPrecision } from '@/lib/money';
import { zodFr } from '@/lib/zod-fr';

/** Délai minimal entre la création et le démarrage (US-4.1). */
export const MIN_START_DELAY_DAYS = 7;

const DRAW_MODE_HELP: Record<string, string> = {
  RANDOM: 'Le bénéficiaire de chaque cycle est tiré au sort (preuve de tirage vérifiable).',
  FIXED_ORDER: 'Vous définissez l’ordre de passage des membres.',
  PRIORITY_NEED: 'Les membres expriment un besoin ; vous désignez le bénéficiaire.',
};

/** Schéma partagé + règles d'interface : date ≥ J+7 et précision des montants selon la devise. */
export function buildCreateTontineFormSchema(today: Date = new Date()) {
  const minDate = isoDateFromToday(MIN_START_DELAY_DAYS, today);
  return createTontineSchema.superRefine((v, ctx) => {
    if (v.startDate < minDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: `La date de début doit être au plus tôt le ${minDate.split('-').reverse().join('/')} (J+7)`,
      });
    }
    const currency = v.currency ?? 'XAF';
    for (const field of ['contributionAmount', 'entryFee', 'collation'] as const) {
      const value = v[field];
      if (!value) continue;
      const msg = validateAmountPrecision(value, currency);
      if (msg && !(field !== 'contributionAmount' && /^0+(\.0+)?$/.test(value))) {
        ctx.addIssue({ code: 'custom', path: [field], message: msg });
      }
    }
  });
}

type FormSchema = ReturnType<typeof buildCreateTontineFormSchema>;
type FormInput = z.input<FormSchema>;

const numberField = { valueAsNumber: true } as const;

export function CreateTontineForm({
  defaultCurrency = 'XAF',
  onSubmit,
  today,
}: {
  defaultCurrency?: string;
  onSubmit: (values: CreateTontineInput) => Promise<void>;
  today?: Date;
}) {
  const [schema] = useState(() => buildCreateTontineFormSchema(today));
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, CreateTontineInput>({
    resolver: zodResolver(schema, zodFr),
    shouldUnregister: true,
    defaultValues: {
      name: '',
      contributionAmount: '',
      currency: defaultCurrency,
      frequency: 'MONTHLY',
      maxMembers: 10,
      startDate: isoDateFromToday(MIN_START_DELAY_DAYS + 7, today),
      drawMode: 'RANDOM',
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 3, defaultAfterDays: 7 },
      incompletePolicy: 'POSTPONE',
    },
  });
  const errors = form.formState.errors;
  const frequency = form.watch('frequency');
  const lastDay = form.watch('frequencyDetail.lastDayOfMonth');
  const currency = form.watch('currency') ?? defaultCurrency;
  const step = amountStep(currency);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setFormError(
        applyServerErrors(e, form.setError, [
          'name',
          'contributionAmount',
          'currency',
          'frequency',
          'frequencyDetail',
          'maxMembers',
          'startDate',
          'drawMode',
          'penaltyRules',
          'entryFee',
          'collation',
          'incompletePolicy',
        ]) ?? null,
      );
    }
  });

  const detailError =
    errors.frequencyDetail?.message ??
    errors.frequencyDetail?.root?.message ??
    errors.frequencyDetail?.day?.message;

  return (
    <form onSubmit={submit} className="space-y-6" noValidate aria-label="Créer une tontine">
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      {Object.keys(errors).length > 0 && form.formState.submitCount > 0 && !formError ? (
        <Alert variant="destructive" title="Certains champs sont à corriger" />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="name" label="Nom de la tontine" error={errors.name?.message} required className="sm:col-span-2">
            <Input {...form.register('name')} maxLength={200} />
          </FormField>
          <FormField
            id="contributionAmount"
            label="Montant de la cotisation"
            error={errors.contributionAmount?.message}
            required
          >
            <Input {...form.register('contributionAmount')} type="number" inputMode="decimal" min="0" step={step} />
          </FormField>
          <FormField
            id="currency"
            label="Devise"
            description="Remplie selon votre pays, modifiable."
            error={errors.currency?.message}
          >
            <Select {...form.register('currency', { setValueAs: emptyToUndefined })}>
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendrier</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="frequency" label="Fréquence" error={errors.frequency?.message} required>
            <Select {...form.register('frequency')}>
              {TONTINE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </Select>
          </FormField>

          {frequency === 'WEEKLY' || frequency === 'BIWEEKLY' ? (
            <FormField id="frequencyDetail.day" label="Jour de la semaine" error={errors.frequencyDetail?.day?.message} required>
              <Select {...form.register('frequencyDetail.day', { setValueAs: emptyToUndefined })}>
                <option value="">Choisir…</option>
                {WEEKDAY_VALUES.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABELS[d]}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          {frequency === 'MONTHLY' ? (
            <Fieldset legend="Jour d’échéance" error={detailError} className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...form.register('frequencyDetail.lastDayOfMonth')} />
                Le dernier jour du mois
              </label>
              {!lastDay ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id="frequencyDetail.day" label="Jour de la semaine">
                    <Select {...form.register('frequencyDetail.day', { setValueAs: emptyToUndefined })}>
                      <option value="">Choisir…</option>
                      {WEEKDAY_VALUES.map((d) => (
                        <option key={d} value={d}>
                          {WEEKDAY_LABELS[d]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="frequencyDetail.weekOfMonth" label="Semaine du mois">
                    <Select
                      {...form.register('frequencyDetail.weekOfMonth', {
                        setValueAs: (v: unknown) => (v === '' || v === undefined ? undefined : Number(v)),
                      })}
                    >
                      <option value="">Choisir…</option>
                      {['1', '2', '3', '4', '-1'].map((w) => (
                        <option key={w} value={w}>
                          {WEEK_OF_MONTH_LABELS[w]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
              ) : null}
            </Fieldset>
          ) : null}

          {frequency === 'BIMONTHLY' ? (
            <p className="self-center text-sm text-muted-foreground">
              Échéances le 15 et le dernier jour de chaque mois.
            </p>
          ) : null}

          <FormField
            id="startDate"
            label="Date de début"
            description={`Au plus tôt dans ${MIN_START_DELAY_DAYS} jours.`}
            error={errors.startDate?.message}
            required
          >
            <Input {...form.register('startDate')} type="date" min={isoDateFromToday(MIN_START_DELAY_DAYS, today)} />
          </FormField>
          <FormField
            id="maxMembers"
            label="Nombre maximum de membres"
            description="Entre 3 et 50 : un tour par membre."
            error={errors.maxMembers?.message}
            required
          >
            <Input {...form.register('maxMembers', numberField)} type="number" min={3} max={50} step={1} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mode de tirage</CardTitle>
        </CardHeader>
        <CardContent>
          <Fieldset legend="Comment le bénéficiaire de chaque cycle est-il choisi ?" error={errors.drawMode?.message}>
            <div className="grid gap-3 sm:grid-cols-3">
              {DRAW_MODES.map((m) => (
                <label
                  key={m}
                  className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
                >
                  <input type="radio" value={m} {...form.register('drawMode')} className="mt-0.5 accent-primary" />
                  <span>
                    <span className="block font-medium">{DRAW_MODE_LABELS[m]}</span>
                    <span className="text-muted-foreground">{DRAW_MODE_HELP[m]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Règles de pénalité</CardTitle>
          <CardDescription>Appliquées automatiquement aux cotisations en retard.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="penaltyRules.graceDays" label="Jours de grâce" error={errors.penaltyRules?.graceDays?.message} required>
            <Input {...form.register('penaltyRules.graceDays', numberField)} type="number" min={0} max={30} />
          </FormField>
          <FormField id="penaltyRules.lateFeePercent" label="Pénalité (%)" error={errors.penaltyRules?.lateFeePercent?.message} required>
            <Input {...form.register('penaltyRules.lateFeePercent', numberField)} type="number" min={0} max={100} step="0.5" />
          </FormField>
          <FormField
            id="penaltyRules.suspendAfter"
            label="Suspension après (défauts)"
            error={errors.penaltyRules?.suspendAfter?.message}
            required
          >
            <Input {...form.register('penaltyRules.suspendAfter', numberField)} type="number" min={1} max={12} />
          </FormField>
          <FormField
            id="penaltyRules.defaultAfterDays"
            label="Défaut après (jours)"
            error={errors.penaltyRules?.defaultAfterDays?.message}
          >
            <Input {...form.register('penaltyRules.defaultAfterDays', numberField)} type="number" min={1} max={60} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Frais et politique</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="entryFee" label="Droit d’entrée (facultatif)" error={errors.entryFee?.message}>
              <Input
                {...form.register('entryFee', { setValueAs: emptyToUndefined })}
                type="number"
                inputMode="decimal"
                min="0"
                step={step}
              />
            </FormField>
            <FormField id="collation" label="Collation par tour (facultatif)" error={errors.collation?.message}>
              <Input
                {...form.register('collation', { setValueAs: emptyToUndefined })}
                type="number"
                inputMode="decimal"
                min="0"
                step={step}
              />
            </FormField>
          </div>
          <Fieldset legend="Si les cotisations d’un cycle sont incomplètes" error={errors.incompletePolicy?.message}>
            {INCOMPLETE_POLICIES.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="radio" value={p} {...form.register('incompletePolicy')} className="accent-primary" />
                {INCOMPLETE_POLICY_LABELS[p]}
              </label>
            ))}
          </Fieldset>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
          Créer la tontine
        </Button>
      </div>
    </form>
  );
}
