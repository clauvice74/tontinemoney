'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginSchema } from '@tontine/contracts';
import { Alert, Button, Checkbox, FormField, Input, OtpInput, PasswordInput } from '@tontine/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { LoginResponse, LoginTokens, Me, MfaChallenge } from '@/lib/api/types';
import { completeLogin } from '@/lib/auth/session';
import { applyServerErrors, formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { zodFr } from '@/lib/zod-fr';

export interface LoginOutcome {
  user: Me;
  mfaSetupRequired: boolean;
  recoveryCodesExhausted: boolean;
}

const mfaCodeSchema = z.object({
  mode: z.enum(['otp', 'recovery']),
  code: z.string().trim(),
});
type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

const refinedMfaSchema = mfaCodeSchema.superRefine((v, ctx) => {
  if (v.mode === 'otp' && !/^\d{6}$/.test(v.code)) {
    ctx.addIssue({ code: 'custom', path: ['code'], message: 'auth.otp.incomplete' });
  }
  if (v.mode === 'recovery' && !/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(v.code)) {
    ctx.addIssue({
      code: 'custom',
      path: ['code'],
      message: 'auth.mfa.recoveryFormat',
    });
  }
});

function isChallenge(r: LoginResponse): r is MfaChallenge {
  return 'mfaRequired' in r && r.mfaRequired === true;
}

/** Connexion (US-1.4) en deux étapes : identifiants puis, si activé, second facteur. */
export function LoginForm({
  onAuthenticated,
  onStart,
}: {
  onAuthenticated: (o: LoginOutcome) => void;
  /** Appelé au début de chaque soumission (avant la mise à jour de la session). */
  onStart?: () => void;
}) {
  const { t } = useI18n();
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const credentials = useForm<LoginInput>({
    resolver: zodResolver(loginSchema, zodFr),
    // « Se souvenir de moi » coché par défaut (A-57)
    defaultValues: { identifier: '', password: '', rememberMe: true },
  });
  const mfa = useForm<MfaCodeInput>({
    resolver: zodResolver(refinedMfaSchema, zodFr),
    defaultValues: { mode: 'otp', code: '' },
  });
  const mode = mfa.watch('mode');

  async function finish(tokens: LoginTokens) {
    onStart?.();
    const user = await completeLogin(tokens);
    onAuthenticated({
      user,
      mfaSetupRequired: !!tokens.user.mfaSetupRequired,
      recoveryCodesExhausted: !!tokens.recoveryCodesExhausted,
    });
  }

  const submitCredentials = credentials.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<LoginResponse>('/auth/login', values, { auth: false });
      if (isChallenge(res)) {
        setChallenge(res);
        mfa.reset({ mode: 'otp', code: '' });
        return;
      }
      await finish(res);
    } catch (e) {
      setFormError(applyServerErrors(e, credentials.setError, ['identifier', 'password']));
    }
  });

  const submitMfa = mfa.handleSubmit(async (values) => {
    if (!challenge) return;
    setFormError(null);
    try {
      const code = values.mode === 'recovery' ? values.code.toUpperCase() : values.code;
      const res = await api.post<LoginTokens>(
        '/auth/login/mfa',
        { challengeToken: challenge.challengeToken, code },
        { auth: false },
      );
      await finish(res);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'INVALID_TOKEN' || e.code === 'TOKEN_EXPIRED')) {
        setChallenge(null);
        setFormError(t('auth.mfa.expired'));
        return;
      }
      if (e instanceof ApiError && e.code === 'INVALID_MFA_CODE') {
        mfa.setError('code', { type: 'server', message: t('auth.mfa.invalid') });
        return;
      }
      setFormError(formatError(e));
    }
  });

  const mfaError = mfa.formState.errors.code?.message;
  const translated = (m?: string) =>
    m === 'auth.otp.incomplete' || m === 'auth.mfa.recoveryFormat' ? t(m) : m;

  if (challenge) {
    return (
      <form onSubmit={submitMfa} className="space-y-5" noValidate aria-labelledby="mfa-title">
        <div className="space-y-1">
          <h2 id="mfa-title" className="text-h3">
            {t('auth.mfa.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {mode === 'recovery'
              ? t('auth.mfa.recoveryHint')
              : challenge.mfaType === 'SMS'
                ? t('auth.mfa.sms')
                : t('auth.mfa.totp')}
          </p>
        </div>
        {formError ? <Alert variant="destructive" title={formError} /> : null}
        {mode === 'recovery' ? (
          <FormField
            id="mfa-code"
            label={t('auth.mfa.recoveryCode')}
            error={translated(mfaError)}
            required
          >
            <Input
              {...mfa.register('code')}
              autoComplete="one-time-code"
              maxLength={9}
              placeholder="XXXX-XXXX"
              autoFocus
            />
          </FormField>
        ) : (
          <FormField id="mfa-code" label={t('auth.mfa.code')} error={translated(mfaError)} required>
            <OtpInput
              value={mfa.watch('code')}
              onValueChange={(v) =>
                mfa.setValue('code', v, { shouldValidate: mfa.formState.isSubmitted })
              }
              autoFocus
            />
          </FormField>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={mfa.formState.isSubmitting}
        >
          {t('auth.mfa.submit')}
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button
            type="button"
            className="font-medium text-info underline-offset-4 hover:underline"
            onClick={() => {
              mfa.reset({ mode: mode === 'otp' ? 'recovery' : 'otp', code: '' });
            }}
          >
            {mode === 'otp' ? t('auth.mfa.useRecovery') : t('auth.mfa.useOtp')}
          </button>
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setChallenge(null);
              setFormError(null);
            }}
          >
            {t('auth.mfa.back')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} className="space-y-5" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField
        id="identifier"
        label={t('auth.login.identifier')}
        error={credentials.formState.errors.identifier?.message}
        required
      >
        <Input
          {...credentials.register('identifier')}
          autoComplete="username"
          placeholder={t('auth.login.identifierPlaceholder')}
          autoFocus
        />
      </FormField>
      <FormField
        id="password"
        label={t('auth.login.password')}
        error={credentials.formState.errors.password?.message}
        required
      >
        <PasswordInput
          {...credentials.register('password')}
          autoComplete="current-password"
          showLabel={t('auth.password.show')}
          hideLabel={t('auth.password.hide')}
        />
      </FormField>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <label htmlFor="rememberMe" className="flex min-h-6 items-center gap-2">
            <Checkbox
              id="rememberMe"
              {...credentials.register('rememberMe')}
              aria-describedby="rememberMe-hint"
            />
            {t('auth.login.remember')}
          </label>
          <p id="rememberMe-hint" className="mt-1 max-w-64 text-xs text-muted-foreground">
            {t('auth.login.rememberHint')}
          </p>
        </div>
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-info underline-offset-4 hover:underline"
        >
          {t('auth.login.forgot')}
        </Link>
      </div>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        loading={credentials.formState.isSubmitting}
      >
        {t('auth.login.submit')}
      </Button>
    </form>
  );
}
