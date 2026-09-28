'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type RequestAccountInput, requestAccountSchema } from '@tontine/contracts';
import { Alert, Button, Fieldset, FormField, Input, Timeline } from '@tontine/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import { api } from '@/lib/api';
import { applyServerErrors, emptyToUndefined } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { zodFr } from '@/lib/zod-fr';

/** Jeton captcha factice accepté par l'adaptateur simulé en développement. */
const DEV_CAPTCHA_TOKEN = 'web-dev-captcha';

type FormInput = z.input<typeof requestAccountSchema>;

/**
 * Inscription (US-1.3) : demande de compte validée par un administrateur, puis code
 * d'activation et création du mot de passe (A-56 : pas de mot de passe à cette étape).
 */
function SignupContent() {
  const { t } = useI18n();
  const params = useSearchParams();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, RequestAccountInput>({
    resolver: zodResolver(requestAccountSchema, zodFr),
    defaultValues: {
      lastName: '',
      firstName: '',
      phone: '',
      email: '',
      preferredChannel: 'SMS',
      invitationCode: params.get('code') ?? undefined,
      captchaToken: DEV_CAPTCHA_TOKEN,
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/auth/request-account', values, { auth: false });
      setSent(true);
    } catch (e) {
      setFormError(
        applyServerErrors(e, form.setError, [
          'firstName',
          'lastName',
          'email',
          'phone',
          'preferredChannel',
          'invitationCode',
          'tontineName',
        ]),
      );
    }
  });

  if (sent) {
    return (
      <AuthCard title={t('auth.signup.sentTitle')} step="validation">
        <div className="space-y-5">
          <Alert variant="success" title={t('auth.signup.sentTitle')}>
            {t('auth.signup.sentBody')}
          </Alert>
          <div className="space-y-3">
            <h2 className="text-h3">{t('auth.signup.nextTitle')}</h2>
            <Timeline
              items={[
                { id: 'v', title: t('auth.signup.nextValidation'), status: 'current' },
                { id: 'c', title: t('auth.signup.nextCode'), status: 'upcoming' },
                { id: 'p', title: t('auth.signup.nextPassword'), status: 'upcoming' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="primary" asChild>
              <Link href="/activate">{t('auth.signup.haveCode')}</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/">{t('auth.signup.backHome')}</Link>
            </Button>
          </div>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.signup.title')}
      description={t('auth.signup.description')}
      step="signup"
      footer={
        <>
          {t('auth.signup.haveAccount')}{' '}
          <Link href="/login" className="font-medium text-info underline underline-offset-4">
            {t('auth.signup.login')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? <Alert variant="destructive" title={formError} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="lastName"
            label={t('auth.signup.lastName')}
            error={errors.lastName?.message}
            required
          >
            <Input {...form.register('lastName')} autoComplete="family-name" />
          </FormField>
          <FormField
            id="firstName"
            label={t('auth.signup.firstName')}
            error={errors.firstName?.message}
            required
          >
            <Input {...form.register('firstName')} autoComplete="given-name" />
          </FormField>
        </div>
        <FormField
          id="phone"
          label={t('auth.signup.phone')}
          description={t('auth.signup.phoneHint')}
          error={errors.phone?.message}
          required
        >
          <Input {...form.register('phone')} type="tel" autoComplete="tel" inputMode="tel" />
        </FormField>
        <FormField id="email" label={t('auth.signup.email')} error={errors.email?.message} required>
          <Input {...form.register('email')} type="email" autoComplete="email" inputMode="email" />
        </FormField>
        <Fieldset legend={t('auth.signup.channel')} error={errors.preferredChannel?.message}>
          <div className="flex gap-6">
            {(['SMS', 'EMAIL'] as const).map((c) => (
              <label key={c} className="flex min-h-10 items-center gap-2">
                <input
                  type="radio"
                  value={c}
                  {...form.register('preferredChannel')}
                  className="size-4 accent-primary"
                />
                {c === 'SMS' ? t('auth.signup.channelSms') : t('auth.signup.channelEmail')}
              </label>
            ))}
          </div>
        </Fieldset>
        <FormField
          id="invitationCode"
          label={t('auth.signup.invitationCode')}
          error={errors.invitationCode?.message}
        >
          <Input
            {...form.register('invitationCode', { setValueAs: emptyToUndefined })}
            autoComplete="off"
          />
        </FormField>
        <FormField
          id="tontineName"
          label={t('auth.signup.tontineName')}
          description={t('auth.signup.tontineNameHint')}
          error={errors.tontineName?.message}
        >
          <Input
            {...form.register('tontineName', { setValueAs: emptyToUndefined })}
            autoComplete="off"
          />
        </FormField>
        <input type="hidden" {...form.register('captchaToken')} />
        <p className="text-xs text-muted-foreground">{t('auth.signup.captchaNote')}</p>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={form.formState.isSubmitting}
        >
          {t('auth.signup.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupContent />
    </Suspense>
  );
}
