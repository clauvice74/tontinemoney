'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { COUNTRIES, type RegisterMemberInput, registerMemberSchema } from '@tontine/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent, Fieldset, FormField, Input, Select } from '@tontine/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Section } from '@/components/page-header';
import { api } from '@/lib/api';
import { applyServerErrors, emptyToUndefined } from '@/lib/forms';
import { zodFr } from '@/lib/zod-fr';

type FormInput = z.input<typeof registerMemberSchema>;
interface RegisterResult {
  id: string;
  status: string;
  channel: string;
}

const COUNTRY_OPTIONS = Object.values(COUNTRIES).sort((a, b) => a.nameFr.localeCompare(b.nameFr));

/** Inscription d'un membre par l'administrateur (US-1.2). */
export default function RegisterMemberPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, RegisterMemberInput>({
    resolver: zodResolver(registerMemberSchema, zodFr),
    defaultValues: { firstName: '', lastName: '', preferredChannel: 'SMS' },
  });
  const errors = form.formState.errors;
  const opt = { setValueAs: emptyToUndefined };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<RegisterResult>(`/tontines/${id}/members`, values);
      setResult(res);
      form.reset({ firstName: '', lastName: '', preferredChannel: values.preferredChannel });
      await queryClient.invalidateQueries({ queryKey: ['tontines', id, 'members'] });
    } catch (e) {
      setFormError(
        applyServerErrors(e, form.setError, [
          'firstName',
          'lastName',
          'email',
          'phone',
          'preferredChannel',
          'dateOfBirth',
          'address',
          'country',
        ]),
      );
    }
  });

  return (
    <Section
      title="Inscrire un membre"
      description="Le membre reçoit un lien (email) ou un code (SMS) pour activer son compte et choisir son mot de passe."
    >
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {result ? (
              <Alert variant="success" title="Membre inscrit">
                Invitation d’activation envoyée par {result.channel === 'EMAIL' ? 'email' : 'SMS'}.{' '}
                <Link className="font-medium underline" href={`/tontines/${id}/admin/members`}>
                  Voir la liste des membres
                </Link>
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
              <FormField
                id="email"
                label="Email"
                description="Email ou téléphone : au moins un des deux."
                error={errors.email?.message}
              >
                <Input {...form.register('email', opt)} type="email" />
              </FormField>
              <FormField id="phone" label="Téléphone" error={errors.phone?.message}>
                <Input {...form.register('phone', opt)} type="tel" placeholder="+237…" />
              </FormField>
              <FormField
                id="dateOfBirth"
                label="Date de naissance"
                error={errors.dateOfBirth?.message}
              >
                <Input {...form.register('dateOfBirth', opt)} type="date" />
              </FormField>
              <FormField id="country" label="Pays" error={errors.country?.message}>
                <Select {...form.register('country', opt)}>
                  <option value="">—</option>
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.nameFr}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                id="address"
                label="Adresse"
                error={errors.address?.message}
                className="sm:col-span-2"
              >
                <Input {...form.register('address', opt)} />
              </FormField>
            </div>
            <Fieldset
              legend="Canal d’envoi de l’activation"
              error={errors.preferredChannel?.message}
            >
              <div className="flex gap-4">
                {(['SMS', 'EMAIL'] as const).map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value={c}
                      {...form.register('preferredChannel')}
                      className="accent-primary"
                    />
                    {c === 'SMS' ? 'SMS (code à 6 chiffres)' : 'Email (lien valable 48 h)'}
                  </label>
                ))}
              </div>
            </Fieldset>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Inscrire
            </Button>
          </form>
        </CardContent>
      </Card>
    </Section>
  );
}
