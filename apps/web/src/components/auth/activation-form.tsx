'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { identifierSchema } from '@tontine/contracts';
import { Alert, Button, FormField, Input, OtpInput, toast } from '@tontine/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import { applyServerErrors, formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { zodFr } from '@/lib/zod-fr';
import { AuthCard } from './auth-card';
import { PasswordFields, newPasswordFields, refinePasswordConfirmation } from './password-fields';

/** Délai avant de pouvoir redemander un code (limite aussi les envois inutiles). */
const RESEND_COOLDOWN_S = 60;

const passwordSchema = z.object(newPasswordFields).superRefine(refinePasswordConfirmation);
type PasswordValues = z.infer<typeof passwordSchema>;

type Step = 'code' | 'password' | 'done';

/**
 * Activation du compte (US-1.1 / US-1.2 / US-1.3) en deux étapes : code à 6 chiffres
 * (15 minutes) puis création du mot de passe — ou mot de passe seul avec un lien (48 h).
 * Le code n'est vérifié qu'à l'envoi final (un seul appel) : s'il est refusé, retour à
 * l'étape « code » avec le motif (invalide, expiré, trop d'essais).
 */
export function ActivationFlow({ token }: { token?: string }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(token ? 'password' : 'code');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (step !== 'code' || cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [step, cooldown]);

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema, zodFr),
    defaultValues: { password: '', confirm: '' },
  });
  const errors = form.formState.errors;

  function validateCode(): boolean {
    const idOk = identifierSchema.safeParse(identifier).success;
    const otpOk = /^\d{6}$/.test(otp);
    setIdentifierError(idOk ? null : t('auth.otp.identifierNeeded'));
    setOtpError(otpOk ? null : t('auth.otp.incomplete'));
    return idOk && otpOk;
  }

  function submitCode(e?: React.FormEvent) {
    e?.preventDefault();
    setCodeError(null);
    if (validateCode()) setStep('password');
  }

  async function resend() {
    const parsed = identifierSchema.safeParse(identifier);
    if (!parsed.success) {
      setIdentifierError(t('auth.otp.identifierNeeded'));
      return;
    }
    setResending(true);
    try {
      await api.post('/auth/activation/resend', { identifier: parsed.data }, { auth: false });
      toast.success(t('auth.otp.resentTitle'), t('auth.otp.resentBody'));
      setCooldown(RESEND_COOLDOWN_S);
      setOtp('');
    } catch (err) {
      toast.error(t('auth.otp.resendFailed'), formatError(err));
    } finally {
      setResending(false);
    }
  }

  const submitPassword = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      const body = token
        ? { token, password: v.password }
        : { identifier: identifierSchema.parse(identifier), otp, password: v.password };
      await api.post('/auth/activate', body, { auth: false });
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError) {
        const back: Record<string, string> = {
          INVALID_OTP: t('auth.otp.invalid'),
          OTP_EXPIRED: t('auth.otp.expired'),
          OTP_LOCKED: t('auth.otp.locked'),
        };
        if (!token && back[err.code]) {
          setCodeError(back[err.code]!);
          setOtp('');
          setStep('code');
          return;
        }
        if (token && ['TOKEN_EXPIRED', 'TOKEN_ALREADY_USED', 'INVALID_TOKEN'].includes(err.code)) {
          setFormError(t('auth.link.expired'));
          return;
        }
      }
      setFormError(applyServerErrors(err, form.setError, ['password']));
    }
  });

  if (step === 'done') {
    return (
      <AuthCard title={t('auth.activated.title')} step="password">
        <div className="space-y-4">
          <Alert variant="success" title={t('auth.activated.title')}>
            {t('auth.activated.body')}
          </Alert>
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link href="/login">{t('auth.activated.cta')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (step === 'code') {
    return (
      <AuthCard title={t('auth.otp.title')} description={t('auth.otp.description')} step="code">
        <form onSubmit={submitCode} className="space-y-5" noValidate>
          {codeError ? <Alert variant="destructive" title={codeError} /> : null}
          <FormField
            id="identifier"
            label={t('auth.otp.identifier')}
            error={identifierError ?? undefined}
            required
          >
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoFocus={!identifier}
            />
          </FormField>
          <FormField id="otp" label={t('auth.otp.code')} error={otpError ?? undefined} required>
            <OtpInput value={otp} onValueChange={setOtp} autoFocus={!!identifier} />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full">
            {t('auth.otp.submit')}
          </Button>
          <div className="text-center">
            {cooldown > 0 ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {t('auth.otp.resendIn', { seconds: cooldown })}
              </p>
            ) : (
              <Button
                type="button"
                variant="link"
                loading={resending}
                onClick={() => void resend()}
              >
                {t('auth.otp.resend')}
              </Button>
            )}
          </div>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={token ? t('auth.link.title') : t('auth.password.title')}
      description={token ? t('auth.link.description') : t('auth.password.description')}
      step="password"
      footer={
        token ? (
          <Link href="/activate" className="font-medium text-info underline underline-offset-4">
            {t('auth.link.useCode')}
          </Link>
        ) : (
          <button
            type="button"
            className="font-medium text-info underline underline-offset-4"
            onClick={() => setStep('code')}
          >
            {t('auth.password.changeCode')}
          </button>
        )
      }
    >
      <form onSubmit={submitPassword} className="space-y-5" noValidate>
        {formError ? <Alert variant="destructive" title={formError} /> : null}
        <PasswordFields
          passwordProps={form.register('password')}
          confirmProps={form.register('confirm')}
          passwordError={errors.password?.message}
          confirmError={errors.confirm?.message}
          value={form.watch('password')}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={form.formState.isSubmitting}
        >
          {t('auth.password.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
