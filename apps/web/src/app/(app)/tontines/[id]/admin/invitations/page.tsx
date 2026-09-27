'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type CreateInvitationInput, createInvitationSchema } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '@tontine/ui';
import { Copy, Link2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ActionDialog } from '@/components/action-dialog';
import { QueryState } from '@/components/feedback';
import { Section } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { InvitationView, ListResponse } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { INVITATION_CHANNEL_LABELS, INVITATION_STATUS_LABELS, label } from '@/lib/labels';
import { frenchErrorMap, zodFr } from '@/lib/zod-fr';

function invitationUrl(inv: InvitationView): string | null {
  if (inv.url) return inv.url;
  if (inv.code && typeof window !== 'undefined')
    return `${window.location.origin}/invitations/${inv.code}`;
  return null;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Lien copié');
  } catch {
    toast.error('Copie impossible', 'Sélectionnez le lien et copiez-le manuellement.');
  }
}

/** Formulaire à plat ; converti en `CreateInvitationInput` (union discriminée) à l'envoi. */
const invitationFormSchema = z
  .object({ channel: z.enum(['EMAIL', 'PHONE', 'LINK']), email: z.string(), phone: z.string() })
  .superRefine((v, ctx) => {
    const body = toBody(v);
    const parsed = createInvitationSchema.safeParse(body, { errorMap: frenchErrorMap });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }
  });
type InvitationFormValues = z.infer<typeof invitationFormSchema>;

function toBody(v: InvitationFormValues): CreateInvitationInput {
  if (v.channel === 'EMAIL') return { channel: 'EMAIL', email: v.email };
  if (v.channel === 'PHONE') return { channel: 'PHONE', phone: v.phone };
  return { channel: 'LINK' };
}

function InvitationForm({
  tontineId,
  onCreated,
}: {
  tontineId: string;
  onCreated: (inv: InvitationView) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<InvitationFormValues>({
    resolver: zodResolver(invitationFormSchema, zodFr),
    defaultValues: { channel: 'EMAIL', email: '', phone: '' },
  });
  const channel = form.watch('channel');
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const inv = await api.post<InvitationView>(
        `/tontines/${tontineId}/invitations`,
        createInvitationSchema.parse(toBody(values)),
      );
      toast.success('Invitation créée');
      onCreated(inv);
      form.reset({ channel: values.channel, email: '', phone: '' });
    } catch (e) {
      setFormError(applyServerErrors(e, form.setError, ['email', 'phone']));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Tabs
        value={channel}
        onValueChange={(v) => {
          if (v === 'EMAIL' || v === 'PHONE' || v === 'LINK') {
            form.setValue('channel', v);
            form.clearErrors();
          }
        }}
      >
        <TabsList>
          <TabsTrigger value="EMAIL">Email</TabsTrigger>
          <TabsTrigger value="PHONE">Téléphone</TabsTrigger>
          <TabsTrigger value="LINK">Lien partageable</TabsTrigger>
        </TabsList>
      </Tabs>
      <input type="hidden" {...form.register('channel')} />
      {formError ? <Alert variant="destructive" title={formError} /> : null}
      {channel === 'EMAIL' ? (
        <FormField id="inv-email" label="Email de l’invité" error={errors.email?.message} required>
          <Input {...form.register('email')} type="email" />
        </FormField>
      ) : null}
      {channel === 'PHONE' ? (
        <FormField
          id="inv-phone"
          label="Téléphone de l’invité"
          error={errors.phone?.message}
          required
        >
          <Input {...form.register('phone')} type="tel" placeholder="+237…" />
        </FormField>
      ) : null}
      {channel === 'LINK' ? (
        <p className="text-sm text-muted-foreground">
          Un lien unique valable 7 jours (ou jusqu’à ce que la tontine soit complète) sera généré.
        </p>
      ) : null}
      <Button type="submit" loading={form.formState.isSubmitting}>
        {channel === 'LINK' ? 'Générer le lien' : 'Envoyer l’invitation'}
      </Button>
    </form>
  );
}

/** Invitations (US-4.2) : email, téléphone, lien partageable ; révocation. */
export default function InvitationsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [lastLink, setLastLink] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['tontines', id, 'invitations'],
    queryFn: () => api.get<ListResponse<InvitationView>>(`/tontines/${id}/invitations`),
  });

  return (
    <div className="space-y-6">
      <Section title="Inviter des membres">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <InvitationForm
              tontineId={id}
              onCreated={(inv) => {
                const url = invitationUrl(inv);
                setLastLink(inv.channel === 'LINK' ? url : null);
                void queryClient.invalidateQueries({ queryKey: ['tontines', id, 'invitations'] });
              }}
            />
            {lastLink ? (
              <Alert variant="success" title="Lien d’invitation">
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    readOnly
                    value={lastLink}
                    aria-label="Lien d’invitation"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copy(lastLink)}
                  >
                    <Copy aria-hidden="true" /> Copier
                  </Button>
                </div>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </Section>
      <Card>
        <CardHeader>
          <CardTitle>Invitations envoyées</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState
            query={list}
            comingSoonTitle="Invitations bientôt disponibles"
            isEmpty={(d) => d.data.length === 0}
            empty={<p className="text-sm text-muted-foreground">Aucune invitation.</p>}
          >
            {(d) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead>Destinataire</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Expire le</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.data.map((inv) => {
                    const url = invitationUrl(inv);
                    return (
                      <TableRow key={inv.id}>
                        <TableCell>{label(INVITATION_CHANNEL_LABELS, inv.channel)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {inv.email ??
                            inv.phone ??
                            (inv.channel === 'LINK' ? (
                              <Link2 className="size-4" aria-label="Lien" />
                            ) : (
                              '—'
                            ))}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={inv.status} labels={INVITATION_STATUS_LABELS} />
                        </TableCell>
                        <TableCell>{formatDate(inv.expiresAt)}</TableCell>
                        <TableCell className="space-x-2 text-right">
                          {url && inv.status === 'PENDING' ? (
                            <Button size="sm" variant="ghost" onClick={() => void copy(url)}>
                              <Copy aria-hidden="true" /> Copier
                            </Button>
                          ) : null}
                          {inv.status === 'PENDING' ? (
                            <ActionDialog
                              trigger="Révoquer"
                              title="Révoquer cette invitation ?"
                              description="Le lien ou le code ne pourra plus être utilisé."
                              confirmVariant="destructive"
                              confirmLabel="Révoquer"
                              successMessage="Invitation révoquée"
                              onConfirm={async () => {
                                await api.delete(`/tontines/${id}/invitations/${inv.id}`);
                                await queryClient.invalidateQueries({
                                  queryKey: ['tontines', id, 'invitations'],
                                });
                              }}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}
