'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { zodFr } from '@/lib/zod-fr';
import { type RequestAccountInput, requestAccountSchema } from '@tontine/contracts';
import { Alert, Button, Fieldset, FormField, Input } from '@tontine/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import { api } from '@/lib/api';
import { applyServerErrors, emptyToUndefined } from '@/lib/forms';

/** Jeton captcha factice accepté par l'adaptateur simulé en développement. */
const DEV_CAPTCHA_TOKEN = 'web-dev-captcha';

type FormInput = z.input<typeof requestAccountSchema>;

function RequestAccountContent() {
  const params = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, RequestAccountInput>({
    resolver: zodResolver(requestAccountSchema, zodFr),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      preferredChannel: 'SMS',
      invitationCode: params.get('code') ?? undefined,
      captchaToken: DEV_CAPTCHA_TOKEN,
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<{ message?: string }>('/auth/request-account', values, {
        auth: false,
      });
      setMessage(
        res?.message ??
          'Votre demande a bien été enregistrée. Vous serez notifié dès qu’elle aura été examinée.',
      );
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

  if (message) {
    return (
      <AuthCard title="Demande envoyée">
        <Alert variant="success" title="Merci !">
          {message}
        </Alert>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/">Retour à l’accueil</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Demander un compte"
      description="Votre demande sera examinée par un administrateur. Vous recevrez ensuite un lien ou un code d’activation."
      footer={
        <>
          Déjà un compte ?{' '}
          <Link href="/login" className="font-medium text-primary underline">
            Se connecter
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? <Alert variant="destructive" title={formError} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="firstName" label="Prénom" error={errors.firstName?.message} required>
            <Input {...form.register('firstName')} autoComplete="given-name" />
          </FormField>
          <FormField id="lastName" label="Nom" error={errors.lastName?.message} required>
            <Input {...form.register('lastName')} autoComplete="family-name" />
          </FormField>
        </div>
        <FormField id="email" label="Email" error={errors.email?.message} required>
          <Input {...form.register('email')} type="email" autoComplete="email" />
        </FormField>
        <FormField
          id="phone"
          label="Téléphone"
          description="Format international, ex. +237 6 99 12 34 56"
          error={errors.phone?.message}
          required
        >
          <Input {...form.register('phone')} type="tel" autoComplete="tel" />
        </FormField>
        <Fieldset legend="Canal de contact préféré" error={errors.preferredChannel?.message}>
          <div className="flex gap-4">
            {(['SMS', 'EMAIL'] as const).map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  value={c}
                  {...form.register('preferredChannel')}
                  className="accent-primary"
                />
                {c === 'SMS' ? 'SMS' : 'Email'}
              </label>
            ))}
          </div>
        </Fieldset>
        <FormField
          id="invitationCode"
          label="Code d’invitation (facultatif)"
          error={errors.invitationCode?.message}
        >
          <Input {...form.register('invitationCode', { setValueAs: emptyToUndefined })} />
        </FormField>
        <FormField
          id="tontineName"
          label="Tontine souhaitée (facultatif)"
          description="Si vous souhaitez créer ou rejoindre une tontine précise."
          error={errors.tontineName?.message}
        >
          <Input {...form.register('tontineName', { setValueAs: emptyToUndefined })} />
        </FormField>
        <input type="hidden" {...form.register('captchaToken')} />
        <p className="text-xs text-muted-foreground">
          Protection anti-robot : vérification simulée en environnement de démonstration.
        </p>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Envoyer ma demande
        </Button>
      </form>
    </AuthCard>
  );
}

export default function RequestAccountPage() {
  return (
    <Suspense>
      <RequestAccountContent />
    </Suspense>
  );
}
