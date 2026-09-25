'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, GENDERS, type UpdateProfileInput, updateProfileSchema } from '@tontine/contracts';
import { Alert, Button, FormField, Input, Select, toast } from '@tontine/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import type { MemberView } from '@/lib/api/types';
import { applyServerErrors, emptyToUndefined } from '@/lib/forms';
import { GENDER_LABELS } from '@/lib/labels';
import { qk } from '@/lib/queries';
import { zodFr } from '@/lib/zod-fr';

type FormInput = z.input<typeof updateProfileSchema>;
const FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'country',
  'region',
  'city',
  'address',
  'dateOfBirth',
  'gender',
  'language',
  'timezone',
] as const;
type Field = (typeof FIELDS)[number];

function toDefaults(p: MemberView): FormInput {
  const v: FormInput = { version: p.version };
  for (const f of FIELDS) {
    const raw = p[f];
    (v as Record<string, unknown>)[f] = raw ?? undefined;
  }
  return v;
}

const COUNTRY_OPTIONS = Object.values(COUNTRIES).sort((a, b) => a.nameFr.localeCompare(b.nameFr));

/** Complétion du profil (US-2.2) avec verrou optimiste (`version`, 409 si obsolète). */
export function ProfileForm({ profile }: { profile: MemberView }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const form = useForm<FormInput, unknown, UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema, zodFr),
    defaultValues: toDefaults(profile),
  });
  const errors = form.formState.errors;
  const nameLocked = profile.kycLevel !== 'NONE';
  const country = form.watch('country') ?? profile.country ?? '';
  const languages = COUNTRIES[country]?.languages ?? ['fr', 'en'];

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    // N'envoie que les champs réellement modifiés.
    const body: Record<string, unknown> = { version: profile.version };
    for (const f of FIELDS) {
      const next = values[f as Field];
      const prev = profile[f as Field] ?? undefined;
      if (next !== undefined && next !== prev) body[f] = next;
    }
    if (Object.keys(body).length === 1) {
      toast({ title: 'Aucune modification à enregistrer' });
      return;
    }
    try {
      const updated = await api.patch<MemberView>('/me/profile', body);
      queryClient.setQueryData(qk.profile, updated);
      form.reset(toDefaults(updated));
      toast.success('Profil mis à jour');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        setConflict(true);
        const fresh = await queryClient.fetchQuery({
          queryKey: qk.profile,
          queryFn: () => api.get<MemberView>('/me/profile'),
          staleTime: 0,
        });
        form.reset(toDefaults(fresh));
        return;
      }
      setFormError(applyServerErrors(e, form.setError, FIELDS));
    }
  });

  const text = (name: Field) => form.register(name, { setValueAs: emptyToUndefined });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {conflict ? (
        <Alert variant="warning" title="Profil modifié entre-temps">
          Votre profil a été modifié depuis un autre appareil. La dernière version a été rechargée :
          vérifiez les informations puis enregistrez à nouveau.
        </Alert>
      ) : null}
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="firstName"
          label="Prénom"
          error={errors.firstName?.message}
          description={nameLocked ? 'Non modifiable après vérification d’identité' : undefined}
        >
          <Input {...text('firstName')} disabled={nameLocked} autoComplete="given-name" />
        </FormField>
        <FormField
          id="lastName"
          label="Nom"
          error={errors.lastName?.message}
          description={nameLocked ? 'Non modifiable après vérification d’identité' : undefined}
        >
          <Input {...text('lastName')} disabled={nameLocked} autoComplete="family-name" />
        </FormField>
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input {...text('email')} type="email" autoComplete="email" />
        </FormField>
        <FormField id="phone" label="Téléphone" error={errors.phone?.message}>
          <Input {...text('phone')} type="tel" autoComplete="tel" />
        </FormField>
        <FormField id="dateOfBirth" label="Date de naissance" error={errors.dateOfBirth?.message}>
          <Input {...text('dateOfBirth')} type="date" autoComplete="bday" />
        </FormField>
        <FormField id="gender" label="Genre" error={errors.gender?.message}>
          <Select {...text('gender')}>
            <option value="">—</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {GENDER_LABELS[g]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="country" label="Pays" error={errors.country?.message}>
          <Select {...text('country')}>
            <option value="">—</option>
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.nameFr}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="region" label="Région" error={errors.region?.message}>
          <Input {...text('region')} />
        </FormField>
        <FormField id="city" label="Ville" error={errors.city?.message}>
          <Input {...text('city')} autoComplete="address-level2" />
        </FormField>
        <FormField id="address" label="Adresse" error={errors.address?.message}>
          <Input {...text('address')} autoComplete="street-address" />
        </FormField>
        <FormField id="language" label="Langue" error={errors.language?.message}>
          <Select {...text('language')}>
            <option value="">—</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l.startsWith('fr') ? `Français (${l})` : `English (${l})`}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="timezone"
          label="Fuseau horaire"
          description="Ex. Africa/Douala"
          error={errors.timezone?.message}
        >
          <Input {...text('timezone')} />
        </FormField>
      </div>
      <input type="hidden" {...form.register('version', { valueAsNumber: true })} />
      <Button type="submit" loading={form.formState.isSubmitting}>
        Enregistrer
      </Button>
    </form>
  );
}
