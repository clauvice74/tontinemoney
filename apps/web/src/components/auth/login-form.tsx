'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { zodFr } from '@/lib/zod-fr';
import { type LoginInput, loginSchema } from '@tontine/contracts';
import { Alert, Button, FormField, Input } from '@tontine/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { LoginResponse, LoginTokens, Me, MfaChallenge } from '@/lib/api/types';
import { completeLogin } from '@/lib/auth/session';
import { applyServerErrors, formatError } from '@/lib/forms';

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
    ctx.addIssue({ code: 'custom', path: ['code'], message: 'Saisissez les 6 chiffres du code' });
  }
  if (v.mode === 'recovery' && !/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(v.code)) {
    ctx.addIssue({
      code: 'custom',
      path: ['code'],
      message: 'Format attendu : XXXX-XXXX',
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
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const credentials = useForm<LoginInput>({
    resolver: zodResolver(loginSchema, zodFr),
    defaultValues: { identifier: '', password: '' },
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
        setFormError('La vérification a expiré. Veuillez vous reconnecter.');
        return;
      }
      if (e instanceof ApiError && e.code === 'INVALID_MFA_CODE') {
        mfa.setError('code', { type: 'server', message: 'Code invalide. Réessayez.' });
        return;
      }
      setFormError(formatError(e));
    }
  });

  if (challenge) {
    return (
      <form onSubmit={submitMfa} className="space-y-4" noValidate aria-labelledby="mfa-title">
        <div className="space-y-1">
          <h2 id="mfa-title" className="text-lg font-medium">
            Vérification en deux étapes
          </h2>
          <p className="text-sm text-muted-foreground">
            {mode === 'recovery'
              ? 'Saisissez l’un de vos codes de récupération (usage unique).'
              : challenge.mfaType === 'SMS'
                ? 'Saisissez le code à 6 chiffres reçu par SMS.'
                : 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.'}
          </p>
        </div>
        {formError ? <Alert variant="destructive" title={formError} /> : null}
        <FormField
          id="mfa-code"
          label={mode === 'recovery' ? 'Code de récupération' : 'Code de vérification'}
          error={mfa.formState.errors.code?.message}
          required
        >
          <Input
            {...mfa.register('code')}
            autoComplete="one-time-code"
            inputMode={mode === 'recovery' ? 'text' : 'numeric'}
            maxLength={mode === 'recovery' ? 9 : 6}
            placeholder={mode === 'recovery' ? 'XXXX-XXXX' : '123456'}
            autoFocus
          />
        </FormField>
        <Button type="submit" className="w-full" loading={mfa.formState.isSubmitting}>
          Vérifier
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => {
              mfa.reset({ mode: mode === 'otp' ? 'recovery' : 'otp', code: '' });
            }}
          >
            {mode === 'otp' ? 'Utiliser un code de récupération' : 'Utiliser un code à 6 chiffres'}
          </button>
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setChallenge(null);
              setFormError(null);
            }}
          >
            Retour
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} className="space-y-4" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <FormField
        id="identifier"
        label="Email ou téléphone"
        error={credentials.formState.errors.identifier?.message}
        required
      >
        <Input
          {...credentials.register('identifier')}
          autoComplete="username"
          placeholder="vous@exemple.com ou +237…"
        />
      </FormField>
      <FormField
        id="password"
        label="Mot de passe"
        error={credentials.formState.errors.password?.message}
        required
      >
        <Input
          {...credentials.register('password')}
          type="password"
          autoComplete="current-password"
        />
      </FormField>
      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Mot de passe oublié ?
        </Link>
      </div>
      <Button type="submit" className="w-full" loading={credentials.formState.isSubmitting}>
        Se connecter
      </Button>
    </form>
  );
}
