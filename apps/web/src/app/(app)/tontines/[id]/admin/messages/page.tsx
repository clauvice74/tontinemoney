'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  MEMBER_STATUSES,
  MESSAGE_TEMPLATES,
  type TargetedMessageInput,
  targetedMessageSchema,
} from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Fieldset,
  FormField,
  Input,
  Select,
  Textarea,
  toast,
} from '@tontine/ui';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { QueryState } from '@/components/feedback';
import { Section } from '@/components/page-header';
import { api } from '@/lib/api';
import type { ListResponse, TargetedMessageView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { applyServerErrors, emptyToUndefined } from '@/lib/forms';
import { MEMBER_STATUS_LABELS, MESSAGE_TEMPLATE_LABELS, label } from '@/lib/labels';
import { zodFr } from '@/lib/zod-fr';

const TEMPLATE_PRESETS: Record<string, { subject: string; body: string }> = {
  REMINDER: {
    subject: 'Rappel : cotisation à régler',
    body: 'Bonjour {prenom}, votre cotisation pour le cycle en cours est attendue. Merci de la régler depuis votre portefeuille.',
  },
  ANNOUNCEMENT: { subject: 'Annonce importante', body: 'Bonjour {prenom}, ' },
  INFORMATION: { subject: 'Information', body: 'Bonjour {prenom}, ' },
  CUSTOM: { subject: '', body: '' },
};

type FormInput = z.input<typeof targetedMessageSchema>;

/** Messagerie ciblée (US-10.3) : modèles, filtre de destinataires, historique. */
export default function TontineMessagesPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['tontines', id, 'messages'],
    queryFn: () => api.get<ListResponse<TargetedMessageView>>(`/tontines/${id}/messages`),
  });
  const form = useForm<FormInput, unknown, TargetedMessageInput>({
    resolver: zodResolver(targetedMessageSchema, zodFr),
    defaultValues: {
      template: 'REMINDER',
      ...TEMPLATE_PRESETS.REMINDER,
      filter: { memberStatuses: [], contributionStatus: undefined },
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const filter = { ...values.filter };
    if (!filter.memberStatuses?.length) delete filter.memberStatuses;
    try {
      const res = await api.post<{ recipientCount?: number }>(`/tontines/${id}/messages`, {
        ...values,
        filter,
      });
      toast.success(
        'Message envoyé',
        res?.recipientCount !== undefined ? `${res.recipientCount} destinataire(s)` : undefined,
      );
      await queryClient.invalidateQueries({ queryKey: ['tontines', id, 'messages'] });
    } catch (e) {
      setFormError(applyServerErrors(e, form.setError, ['template', 'subject', 'body', 'filter']));
    }
  });

  return (
    <div className="space-y-6">
      <Section
        title="Messagerie ciblée"
        description="Variables disponibles : {prenom}, {nom}, {tontine}."
      >
        <Card>
          <CardContent className="pt-5">
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {formError ? <Alert variant="destructive" title={formError} /> : null}
              <FormField id="template" label="Modèle" error={errors.template?.message}>
                <Select
                  {...form.register('template', {
                    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                      const preset = TEMPLATE_PRESETS[e.target.value];
                      if (preset) {
                        form.setValue('subject', preset.subject);
                        form.setValue('body', preset.body);
                      }
                    },
                  })}
                >
                  {MESSAGE_TEMPLATES.map((t) => (
                    <option key={t} value={t}>
                      {MESSAGE_TEMPLATE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField id="subject" label="Objet" error={errors.subject?.message} required>
                <Input {...form.register('subject')} maxLength={150} />
              </FormField>
              <FormField id="body" label="Message" error={errors.body?.message} required>
                <Textarea {...form.register('body')} rows={5} maxLength={1000} />
              </FormField>
              <Controller
                control={form.control}
                name="filter.memberStatuses"
                render={({ field }) => (
                  <Fieldset
                    legend="Destinataires : statut du membre"
                    description="Aucune case cochée = tous les membres."
                  >
                    <div className="grid gap-2 sm:grid-cols-3">
                      {MEMBER_STATUSES.map((s) => {
                        const value = field.value ?? [];
                        return (
                          <label key={s} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={value.includes(s)}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.checked ? [...value, s] : value.filter((x) => x !== s),
                                )
                              }
                            />
                            {MEMBER_STATUS_LABELS[s]}
                          </label>
                        );
                      })}
                    </div>
                  </Fieldset>
                )}
              />
              <FormField
                id="contributionStatus"
                label="Statut de cotisation (cycle en cours)"
                className="max-w-xs"
              >
                <Select
                  {...form.register('filter.contributionStatus', { setValueAs: emptyToUndefined })}
                >
                  <option value="">Tous</option>
                  <option value="LATE">En retard</option>
                  <option value="PENDING">À payer</option>
                  <option value="PAID">Payée</option>
                </Select>
              </FormField>
              <Button type="submit" loading={form.formState.isSubmitting}>
                Envoyer
              </Button>
            </form>
          </CardContent>
        </Card>
      </Section>
      <Card>
        <CardHeader>
          <CardTitle>Historique des envois</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState
            query={history}
            comingSoonTitle="Messagerie bientôt disponible"
            isEmpty={(d) => d.data.length === 0}
            empty={<p className="text-sm text-muted-foreground">Aucun message envoyé.</p>}
          >
            {(d) => (
              <ul className="divide-y">
                {d.data.map((m) => (
                  <li key={m.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{m.subject}</p>
                      <Badge variant="outline">{label(MESSAGE_TEMPLATE_LABELS, m.template)}</Badge>
                      {m.recipientCount !== undefined ? (
                        <span className="text-xs text-muted-foreground">
                          {m.recipientCount} destinataire(s)
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
