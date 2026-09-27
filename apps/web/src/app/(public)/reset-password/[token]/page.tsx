'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { zodFr } from '@/lib/zod-fr';
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

const schema = z.object(newPasswordFields).superRefine(refinePasswordConfirmation);
type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
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
      title="Nouveau mot de passe"
      description="Choisissez un mot de passe différent de vos 5 derniers."
      footer={
        <Link href="/forgot-password" className="font-medium text-primary underline">
          Demander un nouveau lien
        </Link>
      }
    >
      {done ? (
        <div className="space-y-4">
          <Alert variant="success" title="Mot de passe modifié">
            Vos autres sessions ont été fermées. Vous pouvez vous reconnecter.
          </Alert>
          <Button asChild className="w-full">
            <Link href="/login">Se connecter</Link>
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
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Réinitialiser
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
