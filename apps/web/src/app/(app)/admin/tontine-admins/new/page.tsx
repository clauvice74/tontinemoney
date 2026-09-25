'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  COUNTRIES,
  type CreateTontineAdminInput,
  createTontineAdminSchema,
} from '@tontine/contracts';
import { Alert, Button, Card, CardContent, FormField, Input, Select } from '@tontine/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { zodFr } from '@/lib/zod-fr';

type FormInput = z.input<typeof createTontineAdminSchema>;
interface Result {
  id: string;
  status: string;
  activation: { delivered: string[]; failed: string[] };
}

const COUNTRY_OPTIONS = Object.values(COUNTRIES).sort((a, b) => a.nameFr.localeCompare(b.nameFr));

/** Création d'un administrateur de tontine (US-1.1). */
export default function CreateTontineAdminPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, CreateTontineAdminInput>({
    resolver: zodResolver(createTontineAdminSchema, zodFr),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      country: 'CM',
      language: 'fr-CM',
      tontineName: '',
    },
  });
  const errors = form.formState.errors;
  const country = form.watch('country');
  const languages = COUNTRIES[country]?.languages ?? ['fr', 'en'];

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setResult(null);
    try {
      const res = await api.post<Result>('/admin/tontine-admins', values);
      setResult(res);
      form.reset();
    } catch (e) {
      setFormError(
        applyServerErrors(e, form.setError, [
          'firstName',
          'lastName',
          'email',
          'phone',
          'country',
          'language',
          'tontineName',
        ]),
      );
    }
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Créer un administrateur de tontine"
        description="L’administrateur reçoit un lien (email) et un code (SMS) d’activation."
      />
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {result ? (
              <Alert
                variant={result.activation.failed.length ? 'warning' : 'success'}
                title="Compte créé"
              >
                Activation envoyée par : {result.activation.delivered.join(', ') || 'aucun canal'}
                {result.activation.failed.length
                  ? ` · échec : ${result.activation.failed.join(', ')}`
                  : ''}
              </Alert>
            ) : null}
            {formError ? <Alert variant="destructive" title={formError} /> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="firstName" label="Prénom" error={errors.firstName?.message} required>
                <Input {...form.register('firstName')} />
              </FormField>
              <FormField id="lastName" label="Nom" error={errors.lastName?.message} required>
                <Input {...form.register('lastName')} />
              </FormField>
              <FormField id="email" label="Email" error={errors.email?.message} required>
                <Input {...form.register('email')} type="email" />
              </FormField>
              <FormField id="phone" label="Téléphone" error={errors.phone?.message} required>
                <Input {...form.register('phone')} type="tel" placeholder="+237…" />
              </FormField>
              <FormField id="country" label="Pays" error={errors.country?.message} required>
                <Select
                  {...form.register('country', {
                    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                      const lang = COUNTRIES[e.target.value]?.language;
                      if (lang) form.setValue('language', lang);
                    },
                  })}
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.nameFr}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="language" label="Langue" error={errors.language?.message} required>
                <Select {...form.register('language')}>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                id="tontineName"
                label="Nom de la tontine confiée"
                error={errors.tontineName?.message}
                required
                className="sm:col-span-2"
              >
                <Input {...form.register('tontineName')} />
              </FormField>
            </div>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Créer le compte
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
