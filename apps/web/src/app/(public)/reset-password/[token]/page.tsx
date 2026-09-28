'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button } from '@tontine/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import {
  PasswordFields,
  newPasswordFields,
  refinePasswordConfirmation,
} from '@/components/auth/password-fields';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { zodFr } from '@/lib/zod-fr';

const schema = z.object(newPasswordFields).superRefine(refinePasswordConfirmation);
type Values = z.infer<typeof schema>;

/** Nouveau mot de passe (US-1.5) : lien valable 1 heure, 5 derniers mots de passe refusés. */
export default function ResetPasswordPage() {
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token ?? '');
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema, zodFr),
    defaultValues: { password: '', confirm: '' },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', { token, newPassword: v.password }, { auth: false });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.newPassword) {
        form.setError('password', { message: e.fieldErrors.newPassword });
      }
      if (e instanceof ApiError && e.code === 'PASSWORD_REUSED') {
        form.setError('password', { message: e.title });
      }
      setFormError(applyServerErrors(e, form.setError, ['password']));
    }
  });

  return (
    <AuthCard
      title={t('auth.reset.title')}
      description={t('auth.reset.description')}
      footer={
        <Link
          href="/forgot-password"
          className="font-medium text-info underline underline-offset-4"
        >
          {t('auth.reset.newLink')}
        </Link>
      }
    >
      {done ? (
        <div className="space-y-4">
          <Alert variant="success" title={t('auth.reset.doneTitle')}>
            {t('auth.reset.doneBody')}
          </Alert>
          <Button variant="primary" size="lg" asChild className="w-full">
            <Link href="/login">{t('auth.activated.cta')}</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
            {t('auth.reset.submit')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
