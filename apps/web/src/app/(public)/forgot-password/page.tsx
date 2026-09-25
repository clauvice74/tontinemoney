'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { zodFr } from '@/lib/zod-fr';
import { forgotPasswordSchema } from '@tontine/contracts';
import { Alert, Button, FormField, Input } from '@tontine/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema, zodFr),
    defaultValues: { identifier: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<{ message?: string }>('/auth/forgot-password', values, {
        auth: false,
      });
      setSent(res?.message ?? 'Si un compte existe, un lien vous a été envoyé.');
    } catch (e) {
      setFormError(applyServerErrors(e, form.setError, ['identifier']));
    }
  });

  return (
    <AuthCard
      title="Mot de passe oublié"
      description="Saisissez votre email ou votre téléphone : nous vous enverrons un lien de réinitialisation (valable 1 heure)."
      footer={
        <Link href="/login" className="font-medium text-primary underline">
          Retour à la connexion
        </Link>
      }
    >
      {sent ? (
        <Alert variant="success" title="Demande prise en compte">
          {sent}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <Alert variant="destructive" title={formError} /> : null}
          <FormField
            id="identifier"
            label="Email ou téléphone"
            error={form.formState.errors.identifier?.message}
            required
          >
            <Input {...form.register('identifier')} autoComplete="username" />
          </FormField>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Envoyer le lien
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
