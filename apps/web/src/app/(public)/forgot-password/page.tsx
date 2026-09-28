'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema } from '@tontine/contracts';
import { Alert, Button, FormField, Input } from '@tontine/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { zodFr } from '@/lib/zod-fr';

type Values = z.infer<typeof forgotPasswordSchema>;

/** Mot de passe oublié (US-1.5) : réponse identique qu'un compte existe ou non. */
export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema, zodFr),
    defaultValues: { identifier: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/auth/forgot-password', values, { auth: false });
      setSent(true);
    } catch (e) {
      setFormError(applyServerErrors(e, form.setError, ['identifier']));
    }
  });

  return (
    <AuthCard
      title={t('auth.forgot.title')}
      description={t('auth.forgot.description')}
      footer={
        <Link href="/login" className="font-medium text-info underline underline-offset-4">
          {t('auth.forgot.backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <Alert variant="success" title={t('auth.forgot.sentTitle')}>
          {t('auth.forgot.sentBody')}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {formError ? <Alert variant="destructive" title={formError} /> : null}
          <FormField
            id="identifier"
            label={t('auth.forgot.identifier')}
            error={form.formState.errors.identifier?.message}
            required
          >
            <Input {...form.register('identifier')} autoComplete="username" autoFocus />
          </FormField>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            loading={form.formState.isSubmitting}
          >
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
