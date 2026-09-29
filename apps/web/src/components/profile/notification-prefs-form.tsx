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
import { useI18n } from '@/lib/i18n';
import { useLabels } from '@/lib/i18n/labels';
import { qk } from '@/lib/queries';
import { zodFr } from '@/lib/zod-fr';

/** Formulaire : heures calmes activables + catégorie SECURITY toujours incluse (US-8.5). */
const buildSchema = (timeFormat: string) =>
  z
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
          ctx.addIssue({ code: 'custom', path: ['quietStart'], message: timeFormat });
        }
        if (!hhmm.test(v.quietEnd)) {
          ctx.addIssue({ code: 'custom', path: ['quietEnd'], message: timeFormat });
        }
      }
    });
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

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
  const { t } = useI18n();
  const labels = useLabels();
  const [formSchema] = useState(() => buildSchema(t('profile.timeFormat')));
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
      toast.success(t('profile.prefsSaved'));
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
          label={t('profile.channel')}
          error={errors.preferredChannel?.message}
        >
          <Select {...form.register('preferredChannel')}>
            {(['IN_APP', 'SMS', 'EMAIL', 'PUSH'] as const).map((c) => (
              <option key={c} value={c}>
                {labels.notificationChannel[c]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="frequency" label={t('profile.frequency')} error={errors.frequency?.message}>
          <Select {...form.register('frequency')}>
            <option value="IMMEDIATE">{t('profile.immediate')}</option>
            <option value="DAILY_DIGEST">{t('profile.digest')}</option>
          </Select>
        </FormField>
      </div>
      <Controller
        control={form.control}
        name="enabledTypes"
        render={({ field }) => (
          <Fieldset legend={t('profile.categories')} description={t('profile.securityAlways')}>
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
                    {labels.notificationCategory[c]}
                    {security ? (
                      <span id="security-always" className="text-xs text-muted-foreground">
                        {t('profile.mandatory')}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </Fieldset>
        )}
      />
      <Fieldset legend={t('profile.quietHours')} description={t('profile.quietHelp')}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox {...form.register('quietEnabled')} />
          {t('profile.quietEnable')}
        </label>
        {quietEnabled ? (
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <FormField
              id="quietStart"
              label={t('profile.quietStart')}
              error={errors.quietStart?.message}
            >
              <Input {...form.register('quietStart')} type="time" />
            </FormField>
            <FormField id="quietEnd" label={t('profile.quietEnd')} error={errors.quietEnd?.message}>
              <Input {...form.register('quietEnd')} type="time" />
            </FormField>
          </div>
        ) : null}
      </Fieldset>
      <Button type="submit" variant="secondary" loading={form.formState.isSubmitting}>
        {t('profile.savePrefs')}
      </Button>
    </form>
  );
}
