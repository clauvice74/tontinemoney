'use client';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Textarea,
  toast,
} from '@tontine/ui';
import { useId, useState } from 'react';
import { z } from 'zod';
import { formatError } from '@/lib/forms';

const uuid = z.string().uuid();

/**
 * Action d'administration ciblant une ressource par identifiant, avec motif obligatoire
 * (remboursement, pause de tontine, signalement de fraude…).
 */
export function IdActionForm({
  title,
  description,
  idLabel,
  submitLabel,
  successMessage,
  destructive,
  onSubmit,
  initialId = '',
}: {
  title: string;
  description?: string;
  idLabel: string;
  submitLabel: string;
  successMessage: string;
  destructive?: boolean;
  onSubmit: (id: string, reason: string) => Promise<unknown>;
  initialId?: string;
}) {
  const uid = useId();
  const [id, setId] = useState(initialId);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ id?: string; reason?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: { id?: string; reason?: string } = {};
    if (!uuid.safeParse(id.trim()).success) next.id = 'Identifiant invalide (UUID attendu)';
    if (!reason.trim()) next.reason = 'Le motif est obligatoire';
    setErrors(next);
    if (next.id || next.reason) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(id.trim(), reason.trim());
      toast.success(successMessage);
      setReason('');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error ? <Alert variant="destructive" title={error} /> : null}
          <FormField id={`${uid}-id`} label={idLabel} error={errors.id} required>
            <Input value={id} onChange={(e) => setId(e.target.value)} className="font-mono" />
          </FormField>
          <FormField id={`${uid}-reason`} label="Motif" error={errors.reason} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </FormField>
          <Button type="submit" variant={destructive ? 'destructive' : 'default'} loading={pending}>
            {submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
