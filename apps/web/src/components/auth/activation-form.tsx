'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { zodFr } from '@/lib/zod-fr';
import { identifierSchema } from '@tontine/contracts';
import { Alert, Button, FormField, Input, toast } from '@tontine/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import { applyServerErrors, formatError } from '@/lib/forms';
import { PasswordFields, newPasswordFields, refinePasswordConfirmation } from './password-fields';

const activationSchema = z
  .object({
    mode: z.enum(['token', 'otp']),
    identifier: z.string().trim(),
    otp: z.string().trim(),
    ...newPasswordFields,
  })
  .superRefine((v, ctx) => {
    refinePasswordConfirmation(v, ctx);
    if (v.mode === 'otp') {
      if (!identifierSchema.safeParse(v.identifier).success) {
        ctx.addIssue({ code: 'custom', path: ['identifier'], message: 'Identifiant requis' });
      }
      if (!/^\d{6}$/.test(v.otp)) {
        ctx.addIssue({ code: 'custom', path: ['otp'], message: 'Le code comporte 6 chiffres' });
      }
    }
  });
type ActivationValues = z.infer<typeof activationSchema>;

/**
 * Activation de compte (US-1.1 / US-1.2) : par lien (jeton, 48 h) ou par code OTP (15 min).
 * Choix du mot de passe dans les deux cas.
 */
export function ActivationForm({ token }: { token?: string }) {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const form = useForm<ActivationValues>({
    resolver: zodResolver(activationSchema, zodFr),
    defaultValues: {
      mode: token ? 'token' : 'otp',
      identifier: '',
      otp: '',
      password: '',
      confirm: '',
    },
  });
  const password = form.watch('password');
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      const body = token
        ? { token, password: v.password }
        : { identifier: v.identifier, otp: v.otp, password: v.password };
      await api.post('/auth/activate', body, { auth: false });
      setDone(true);
      toast.success('Compte activé');
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_ALREADY_USED')
      ) {
        setFormError(
          token
            ? `${e.title}. Vous pouvez activer votre compte avec le code reçu, ou demander un nouveau code.`
            : e.title,
        );
        return;
      }
      setFormError(applyServerErrors(e, form.setError, ['password', 'identifier', 'otp']));
    }
  });

  async function resend() {
    const parsed = identifierSchema.safeParse(form.getValues('identifier'));
    if (!parsed.success) {
      form.setError('identifier', {
        message: 'Saisissez votre email ou téléphone pour recevoir un nouveau code',
      });
      return;
    }
    setResending(true);
    try {
      await api.post('/auth/activation/resend', { identifier: parsed.data }, { auth: false });
      toast.success(
        'Code renvoyé',
        'Si un compte en attente existe, un nouveau code a été envoyé.',
      );
    } catch (e) {
      toast.error('Envoi impossible', formatError(e));
    } finally {
      setResending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert variant="success" title="Votre compte est activé">
          Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
        </Alert>
        <Button asChild className="w-full">
          <Link href="/login">Se connecter</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      {!token ? (
        <>
          <FormField
            id="identifier"
            label="Email ou téléphone"
            error={errors.identifier?.message}
            required
          >
            <Input {...form.register('identifier')} autoComplete="username" />
          </FormField>
          <FormField
            id="otp"
            label="Code d’activation"
            description="Code à 6 chiffres reçu par SMS ou email (valable 15 minutes)."
            error={errors.otp?.message}
            required
          >
            <Input
              {...form.register('otp')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </FormField>
          <Button
            type="button"
            variant="link"
            className="h-auto px-0"
            onClick={() => void resend()}
            loading={resending}
          >
            Renvoyer le code
          </Button>
        </>
      ) : null}
      <PasswordFields
        passwordProps={form.register('password')}
        confirmProps={form.register('confirm')}
        passwordError={errors.password?.message}
        confirmError={errors.confirm?.message}
        value={password}
      />
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Activer mon compte
      </Button>
    </form>
  );
}
