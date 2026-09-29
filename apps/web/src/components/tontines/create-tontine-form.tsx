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
  toMinor,
} from '@tontine/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Fieldset,
  FormField,
  Input,
  Select,
  Stepper,
  Textarea,
} from '@tontine/ui';
import { ArrowLeft, Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { type FieldPath, useForm } from 'react-hook-form';
import type { z } from 'zod';
import type { MoneyView } from '@/lib/api/types';
import { applyServerErrors, emptyToUndefined } from '@/lib/forms';
import { isoDateFromToday } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { amountStep, validateAmountPrecision } from '@/lib/money';
import { zodFr } from '@/lib/zod-fr';
import { Amount } from '../amount';

/** Délai minimal entre la création et le démarrage (US-4.1). */
export const MIN_START_DELAY_DAYS = 7;

/** Schéma partagé + règles d'interface : date ≥ J+7 et précision des montants selon la devise. */
export function buildCreateTontineFormSchema(
  today: Date = new Date(),
  startTooEarly: (date: string) => string = (d) =>
    `La date de début doit être au plus tôt le ${d} (J+7)`,
) {
  const minDate = isoDateFromToday(MIN_START_DELAY_DAYS, today);
  return createTontineSchema.superRefine((v, ctx) => {
    if (v.startDate < minDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: startTooEarly(minDate.split('-').reverse().join('/')),
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

/** Champs validés à chaque étape (la dernière valide le tout). */
const STEP_FIELDS: Array<Array<FieldPath<FormInput>>> = [
  ['name', 'drawMode'],
  ['contributionAmount', 'currency', 'frequency', 'frequencyDetail', 'startDate', 'maxMembers'],
  ['penaltyRules', 'entryFee', 'collation', 'incompletePolicy'],
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

export type InviteTarget =
  { channel: 'EMAIL'; email: string } | { channel: 'PHONE'; phone: string };

/** Une adresse e-mail ou un numéro E.164 par ligne ; renvoie la première ligne invalide. */
export function parseInvitees(text: string): { targets: InviteTarget[]; invalidLine?: number } {
  const targets: InviteTarget[] = [];
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim().replace(/[\s.-](?=\d)/g, '');
    if (!line) continue;
    if (EMAIL_RE.test(raw.trim())) targets.push({ channel: 'EMAIL', email: raw.trim() });
    else if (PHONE_RE.test(line)) targets.push({ channel: 'PHONE', phone: line });
    else return { targets, invalidLine: i + 1 };
  }
  return { targets };
}

function potPreview(amount: string, currency: string, members: number): MoneyView | null {
  try {
    if (!amount || !Number.isInteger(members) || members < 1) return null;
    const minor = toMinor(amount, currency) * BigInt(members);
    return { amount: '', amountMinor: minor.toString(), currency };
  } catch {
    return null;
  }
}

/**
 * Assistant de création en 4 étapes (US-4.1) : 1 type, 2 montant / devise / fréquence,
 * 3 règles, 4 invitations. Toutes les étapes restent montées (masquées) pour conserver
 * les valeurs ; chaque « Continuer » valide les champs de l'étape.
 */
export function CreateTontineForm({
  defaultCurrency = 'XAF',
  onSubmit,
  today,
  mode = 'create',
  initialValues,
  submitLabel,
}: {
  defaultCurrency?: string;
  onSubmit: (values: CreateTontineInput, invitees: InviteTarget[]) => Promise<void>;
  today?: Date;
  /** `edit` (A-61) : 3 étapes, sans invitations ; devise non modifiable. */
  mode?: 'create' | 'edit';
  initialValues?: Partial<FormInput>;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const [schema] = useState(() =>
    buildCreateTontineFormSchema(today, (date) => t('wizard.startDateTooEarly', { date })),
  );
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [invitees, setInvitees] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const form = useForm<FormInput, unknown, CreateTontineInput>({
    resolver: zodResolver(schema, zodFr),
    shouldUnregister: true,
    defaultValues: {
      name: '',
      contributionAmount: '',
      currency: defaultCurrency,
      frequency: 'MONTHLY',
      frequencyDetail: { lastDayOfMonth: true },
      maxMembers: 10,
      startDate: isoDateFromToday(MIN_START_DELAY_DAYS + 7, today),
      drawMode: 'RANDOM',
      penaltyRules: { graceDays: 3, lateFeePercent: 5, suspendAfter: 3, defaultAfterDays: 7 },
      incompletePolicy: 'POSTPONE',
      ...initialValues,
    },
  });
  const errors = form.formState.errors;
  const frequency = form.watch('frequency');
  const lastDay = form.watch('frequencyDetail.lastDayOfMonth');
  const currency = form.watch('currency') ?? defaultCurrency;
  const amountStepValue = amountStep(currency);
  const steps = [
    t('wizard.steps.type'),
    t('wizard.steps.amount'),
    t('wizard.steps.rules'),
    ...(mode === 'create' ? [t('wizard.steps.invitations')] : []),
  ];

  function goTo(next: number) {
    setStep(next);
    setFormError(null);
    // Focus sur le titre de l'étape : annoncé par les lecteurs d'écran, en haut sur mobile.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function next() {
    const fields = STEP_FIELDS[step];
    if (fields && !(await form.trigger(fields, { shouldFocus: true }))) return;
    goTo(step + 1);
  }

  /** Étape de la première erreur (validation finale ou erreur serveur). */
  function stepOfErrors(errs: object = form.formState.errors): number {
    const keys = Object.keys(errs);
    const idx = STEP_FIELDS.findIndex((fs) => fs.some((k) => keys.includes(k.split('.')[0]!)));
    return idx === -1 ? step : idx;
  }

  const submit = form.handleSubmit(
    async (values) => {
      setFormError(null);
      const parsed = parseInvitees(invitees);
      if (parsed.invalidLine) {
        setInviteError(t('wizard.invitationsInvalid', { line: parsed.invalidLine }));
        return;
      }
      setInviteError(null);
      try {
        await onSubmit(values, parsed.targets);
      } catch (e) {
        const msg = applyServerErrors(e, form.setError, [
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
        ]);
        setFormError(msg ?? null);
        const s = stepOfErrors();
        if (s !== step) goTo(s);
      }
    },
    (errs) => {
      goTo(stepOfErrors(errs));
      setFormError(t('wizard.fixErrors'));
    },
  );

  const detailError =
    errors.frequencyDetail?.message ??
    errors.frequencyDetail?.root?.message ??
    errors.frequencyDetail?.day?.message;

  const values = form.watch();
  const contribution = potPreview(values.contributionAmount ?? '', currency, 1);
  const pot = potPreview(values.contributionAmount ?? '', currency, Number(values.maxMembers));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (step < steps.length - 1) void next();
        else void submit(e);
      }}
      className="space-y-6"
      noValidate
      aria-label={mode === 'edit' ? t('adminT.settings.title') : t('wizard.title')}
    >
      <Stepper steps={steps} current={step} label={t('wizard.stepsLabel')} />

      <Card>
        <CardHeader>
          <h2 ref={headingRef} tabIndex={-1} className="text-h3 focus:outline-none">
            {t('wizard.stepOf', { current: step + 1, total: steps.length })} — {steps[step]}
          </h2>
        </CardHeader>
        <CardContent className="space-y-5">
          {formError ? <Alert variant="destructive" title={formError} /> : null}

          {/* 1. Type */}
          <div hidden={step !== 0} className="space-y-5">
            <Fieldset legend={t('wizard.typeTitle')}>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-primary bg-secondary p-4 text-sm">
                <input
                  type="radio"
                  name="tontine-type"
                  value="SIMPLE_ROTATIVE"
                  defaultChecked
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <span className="block font-medium">{t('wizard.typeRotating')}</span>
                  <span className="text-muted-foreground">{t('wizard.typeRotatingHelp')}</span>
                </span>
              </label>
            </Fieldset>
            <FormField id="name" label={t('wizard.name')} error={errors.name?.message} required>
              <Input {...form.register('name')} maxLength={200} autoComplete="off" />
            </FormField>
            <Fieldset legend={t('wizard.drawModeLegend')} error={errors.drawMode?.message}>
              <div className="grid gap-3 sm:grid-cols-3">
                {DRAW_MODES.map((m) => (
                  <label
                    key={m}
                    className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
                  >
                    <input
                      type="radio"
                      value={m}
                      {...form.register('drawMode')}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className="block font-medium">{labels.drawMode[m]}</span>
                      <span className="text-muted-foreground">{t(`wizard.drawHelp.${m}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Fieldset>
          </div>

          {/* 2. Montant, devise, fréquence */}
          <div hidden={step !== 1} className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="contributionAmount"
              label={t('wizard.amount')}
              error={errors.contributionAmount?.message}
              required
            >
              <Input
                {...form.register('contributionAmount')}
                type="number"
                inputMode="decimal"
                min="0"
                step={amountStepValue}
              />
            </FormField>
            <FormField
              id="currency"
              label={t('wizard.currency')}
              description={t('wizard.currencyHint')}
              error={errors.currency?.message}
            >
              <Select
                {...form.register('currency', { setValueAs: emptyToUndefined })}
                disabled={mode === 'edit'}
              >
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              id="frequency"
              label={t('wizard.frequency')}
              error={errors.frequency?.message}
              required
            >
              <Select {...form.register('frequency')}>
                {TONTINE_FREQUENCIES.map((x) => (
                  <option key={x} value={x}>
                    {labels.frequency[x]}
                  </option>
                ))}
              </Select>
            </FormField>

            {frequency === 'WEEKLY' || frequency === 'BIWEEKLY' ? (
              <FormField
                id="frequencyDetail.day"
                label={t('wizard.weekday')}
                error={errors.frequencyDetail?.day?.message}
                required
              >
                <Select {...form.register('frequencyDetail.day', { setValueAs: emptyToUndefined })}>
                  <option value="">{t('wizard.choose')}</option>
                  {WEEKDAY_VALUES.map((d) => (
                    <option key={d} value={d}>
                      {labels.weekday[d]}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            {frequency === 'BIMONTHLY' ? (
              <p className="self-center text-sm text-muted-foreground">{t('wizard.bimonthly')}</p>
            ) : null}

            {frequency === 'MONTHLY' ? (
              <Fieldset legend={t('wizard.dueDay')} error={detailError} className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox {...form.register('frequencyDetail.lastDayOfMonth')} />
                  {t('wizard.lastDay')}
                </label>
                {!lastDay ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField id="frequencyDetail.day" label={t('wizard.weekday')}>
                      <Select
                        {...form.register('frequencyDetail.day', {
                          setValueAs: emptyToUndefined,
                        })}
                      >
                        <option value="">{t('wizard.choose')}</option>
                        {WEEKDAY_VALUES.map((d) => (
                          <option key={d} value={d}>
                            {labels.weekday[d]}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField id="frequencyDetail.weekOfMonth" label={t('wizard.weekOfMonth')}>
                      <Select
                        {...form.register('frequencyDetail.weekOfMonth', {
                          setValueAs: (v: unknown) =>
                            v === '' || v === undefined ? undefined : Number(v),
                        })}
                      >
                        <option value="">{t('wizard.choose')}</option>
                        {['1', '2', '3', '4', '-1'].map((w) => (
                          <option key={w} value={w}>
                            {labels.weekOfMonth[w]}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                ) : null}
              </Fieldset>
            ) : null}

            <FormField
              id="startDate"
              label={t('wizard.startDate')}
              description={t('wizard.startDateHint', { days: MIN_START_DELAY_DAYS })}
              error={errors.startDate?.message}
              required
            >
              <Input
                {...form.register('startDate')}
                type="date"
                min={isoDateFromToday(MIN_START_DELAY_DAYS, today)}
              />
            </FormField>
            <FormField
              id="maxMembers"
              label={t('wizard.maxMembers')}
              description={t('wizard.maxMembersHint')}
              error={errors.maxMembers?.message}
              required
            >
              <Input
                {...form.register('maxMembers', numberField)}
                type="number"
                min={3}
                max={50}
                step={1}
              />
            </FormField>
            {pot ? (
              <p
                className="rounded-md bg-gold-pale p-3 text-sm text-warning sm:col-span-2"
                aria-live="polite"
              >
                {t('wizard.potLabel')} <Amount value={pot} />
              </p>
            ) : null}
          </div>

          {/* 3. Règles */}
          <div hidden={step !== 2} className="space-y-5">
            <Fieldset legend={t('wizard.penaltiesTitle')}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField
                  id="penaltyRules.graceDays"
                  label={t('wizard.graceDays')}
                  error={errors.penaltyRules?.graceDays?.message}
                  required
                >
                  <Input
                    {...form.register('penaltyRules.graceDays', numberField)}
                    type="number"
                    min={0}
                    max={30}
                  />
                </FormField>
                <FormField
                  id="penaltyRules.lateFeePercent"
                  label={t('wizard.lateFee')}
                  error={errors.penaltyRules?.lateFeePercent?.message}
                  required
                >
                  <Input
                    {...form.register('penaltyRules.lateFeePercent', numberField)}
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                  />
                </FormField>
                <FormField
                  id="penaltyRules.suspendAfter"
                  label={t('wizard.suspendAfter')}
                  error={errors.penaltyRules?.suspendAfter?.message}
                  required
                >
                  <Input
                    {...form.register('penaltyRules.suspendAfter', numberField)}
                    type="number"
                    min={1}
                    max={12}
                  />
                </FormField>
                <FormField
                  id="penaltyRules.defaultAfterDays"
                  label={t('wizard.defaultAfter')}
                  error={errors.penaltyRules?.defaultAfterDays?.message}
                >
                  <Input
                    {...form.register('penaltyRules.defaultAfterDays', numberField)}
                    type="number"
                    min={1}
                    max={60}
                  />
                </FormField>
              </div>
            </Fieldset>
            <Fieldset legend={t('wizard.feesTitle')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="entryFee"
                  label={t('wizard.entryFee')}
                  error={errors.entryFee?.message}
                >
                  <Input
                    {...form.register('entryFee', { setValueAs: emptyToUndefined })}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={amountStepValue}
                  />
                </FormField>
                <FormField
                  id="collation"
                  label={t('wizard.collation')}
                  error={errors.collation?.message}
                >
                  <Input
                    {...form.register('collation', { setValueAs: emptyToUndefined })}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={amountStepValue}
                  />
                </FormField>
              </div>
            </Fieldset>
            <Fieldset
              legend={t('wizard.incompleteLegend')}
              error={errors.incompletePolicy?.message}
            >
              {INCOMPLETE_POLICIES.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    value={p}
                    {...form.register('incompletePolicy')}
                    className="accent-primary"
                  />
                  {labels.incompletePolicy[p]}
                </label>
              ))}
            </Fieldset>
          </div>

          {/* 4. Invitations + récapitulatif */}
          <div hidden={step !== 3} className="space-y-5">
            <FormField
              id="invitees"
              label={t('wizard.invitationsLabel')}
              description={t('wizard.invitationsHelp')}
              error={inviteError ?? undefined}
            >
              <Textarea
                rows={5}
                value={invitees}
                onChange={(e) => setInvitees(e.target.value)}
                placeholder={'awa@example.org\n+237600000000'}
                autoComplete="off"
              />
            </FormField>
            <section aria-labelledby="wizard-summary" className="rounded-md bg-muted p-4">
              <h3 id="wizard-summary" className="mb-3 text-sm font-medium">
                {t('wizard.summaryTitle')}
              </h3>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {(
                  [
                    [t('wizard.name'), values.name || '—'],
                    [t('wizard.amount'), contribution ? <Amount value={contribution} /> : '—'],
                    [t('wizard.frequency'), labels.frequency[values.frequency] ?? values.frequency],
                    [t('wizard.maxMembers'), String(values.maxMembers ?? '—')],
                    [t('wizard.startDate'), f.date(values.startDate)],
                    [t('tontine.drawMode'), labels.drawMode[values.drawMode] ?? values.drawMode],
                  ] as Array<[string, React.ReactNode]>
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => goTo(step - 1)}>
            <ArrowLeft aria-hidden="true" /> {t('wizard.back')}
          </Button>
        ) : (
          <span />
        )}
        {step < steps.length - 1 ? (
          <Button type="submit" variant="secondary" size="lg">
            {t('wizard.next')}
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? null : <Check aria-hidden="true" />}
            {submitLabel ?? t('wizard.submit')}
          </Button>
        )}
      </div>
    </form>
  );
}
