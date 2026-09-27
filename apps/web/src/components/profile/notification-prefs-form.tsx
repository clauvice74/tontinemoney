'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPrefs,
  notificationPrefsSchema,
} from '@tontine/contracts';
import { Alert, Button, Checkbox, Fieldset, FormField, Input, Select, toast } from '@tontine/ui';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import type { MemberView } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/forms';
import { NOTIFICATION_CATEGORY_LABELS, NOTIFICATION_CHANNEL_LABELS } from '@/lib/labels';
import { qk } from '@/lib/queries';
import { zodFr } from '@/lib/zod-fr';

/** Formulaire : heures calmes activables + catégorie SECURITY toujours incluse (US-8.5). */
const formSchema = z
  .object({
    preferredChannel: notificationPrefsSchema.shape.preferredChannel,
    frequency: z.enum(['IMMEDIATE', 'DAILY_DIGEST']),
    enabledTypes: z.array(z.enum(NOTIFICATION_CATEGORIES)),
    quietEnabled: z.boolean(),
    quietStart: z.string(),
    quietEnd: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.quietEnabled) {
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!hhmm.test(v.quietStart)) {
        ctx.addIssue({ code: 'custom', path: ['quietStart'], message: 'Heure attendue HH:MM' });
      }
      if (!hhmm.test(v.quietEnd)) {
        ctx.addIssue({ code: 'custom', path: ['quietEnd'], message: 'Heure attendue HH:MM' });
      }
    }
  });
type FormValues = z.infer<typeof formSchema>;

function defaults(prefs: MemberView['notificationPrefs']): FormValues {
  const types = new Set<NotificationCategory>(prefs?.enabledTypes ?? [...NOTIFICATION_CATEGORIES]);
  types.add('SECURITY');
  return {
    preferredChannel: prefs?.preferredChannel ?? 'IN_APP',
    frequency: prefs?.frequency ?? 'IMMEDIATE',
    enabledTypes: [...types],
    quietEnabled: !!prefs?.quietHours,
    quietStart: prefs?.quietHours?.start ?? '22:00',
    quietEnd: prefs?.quietHours?.end ?? '07:00',
  };
}

export function NotificationPrefsForm({ profile }: { profile: MemberView }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema, zodFr),
    defaultValues: defaults(profile.notificationPrefs),
  });
  const quietEnabled = form.watch('quietEnabled');
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    const body: NotificationPrefs = {
      preferredChannel: v.preferredChannel,
      frequency: v.frequency,
      enabledTypes: [...new Set<NotificationCategory>([...v.enabledTypes, 'SECURITY'])],
      quietHours: v.quietEnabled ? { start: v.quietStart, end: v.quietEnd } : null,
    };
    try {
      await api.put('/me/notification-preferences', body);
      await queryClient.invalidateQueries({ queryKey: qk.profile });
      toast.success('Préférences enregistrées');
    } catch (e) {
      setFormError(applyServerErrors(e, form.setError, ['preferredChannel', 'frequency']));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="preferredChannel"
          label="Canal préféré"
          error={errors.preferredChannel?.message}
        >
          <Select {...form.register('preferredChannel')}>
            {(['IN_APP', 'SMS', 'EMAIL', 'PUSH'] as const).map((c) => (
              <option key={c} value={c}>
                {NOTIFICATION_CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="frequency" label="Fréquence" error={errors.frequency?.message}>
          <Select {...form.register('frequency')}>
            <option value="IMMEDIATE">Immédiate</option>
            <option value="DAILY_DIGEST">Résumé quotidien</option>
          </Select>
        </FormField>
      </div>
      <Controller
        control={form.control}
        name="enabledTypes"
        render={({ field }) => (
          <Fieldset
            legend="Catégories de notifications"
            description="Les alertes de sécurité sont toujours envoyées."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {NOTIFICATION_CATEGORIES.map((c) => {
                const security = c === 'SECURITY';
                const checked = security || field.value.includes(c);
                return (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      disabled={security}
                      aria-describedby={security ? 'security-always' : undefined}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...field.value, c]
                          : field.value.filter((x) => x !== c);
                        field.onChange(next);
                      }}
                    />
                    {NOTIFICATION_CATEGORY_LABELS[c]}
                    {security ? (
                      <span id="security-always" className="text-xs text-muted-foreground">
                        (obligatoire)
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </Fieldset>
        )}
      />
      <Fieldset
        legend="Heures calmes"
        description="Aucune notification non urgente pendant cette plage."
      >
        <label className="flex items-center gap-2 text-sm">
          <Checkbox {...form.register('quietEnabled')} />
          Activer les heures calmes
        </label>
        {quietEnabled ? (
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <FormField id="quietStart" label="Début" error={errors.quietStart?.message}>
              <Input {...form.register('quietStart')} type="time" />
            </FormField>
            <FormField id="quietEnd" label="Fin" error={errors.quietEnd?.message}>
              <Input {...form.register('quietEnd')} type="time" />
            </FormField>
          </div>
        ) : null}
      </Fieldset>
      <Button type="submit" loading={form.formState.isSubmitting}>
        Enregistrer les préférences
      </Button>
    </form>
  );
}
