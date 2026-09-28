'use client';

import { createInvitationSchema, type CreateInvitationInput } from '@tontine/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  type ButtonProps,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormField,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '@tontine/ui';
import { Copy, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { InvitationView } from '@/lib/api/types';
import { formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { zodFr } from '@/lib/zod-fr';

type Channel = 'EMAIL' | 'PHONE' | 'LINK';

export function invitationUrl(inv: InvitationView): string | null {
  if (inv.url) return inv.url;
  if (inv.code && typeof window !== 'undefined')
    return `${window.location.origin}/invitations/${inv.code}`;
  return null;
}

function InviteContent({ tontineId, onClose }: { tontineId: string; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  function body(): CreateInvitationInput | null {
    const raw =
      channel === 'EMAIL'
        ? { channel, email: value.trim() }
        : channel === 'PHONE'
          ? { channel, phone: value.trim() }
          : { channel };
    const parsed = createInvitationSchema.safeParse(raw, zodFr);
    if (parsed.success) return parsed.data;
    setFieldError(parsed.error.issues[0]?.message ?? null);
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);
    const b = body();
    if (!b) return;
    setPending(true);
    try {
      const inv = await api.post<InvitationView>(`/tontines/${tontineId}/invitations`, b);
      await queryClient.invalidateQueries({ queryKey: ['tontines', tontineId, 'invitations'] });
      if (channel === 'LINK') {
        setLink(invitationUrl(inv));
      } else {
        toast.success(t('invite.sent'));
        setValue('');
      }
    } catch (err) {
      setFormError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('invite.copied'));
    } catch {
      /* le champ reste sélectionnable pour une copie manuelle */
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('invite.title')}</DialogTitle>
        <DialogDescription>{t('invite.description')}</DialogDescription>
      </DialogHeader>
      {link ? (
        <div className="space-y-3">
          <Alert variant="success" title={t('invite.linkReady')} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={link}
              aria-label={t('invite.link')}
              onFocus={(e) => e.target.select()}
            />
            <Button type="button" variant="outline" onClick={() => void copy(link)}>
              <Copy aria-hidden="true" /> {t('invite.copy')}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLink(null)}>
              {t('invite.another')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('invite.close')}
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id="invite-channel">
              {t('invite.channel')}
            </p>
            <Tabs
              value={channel}
              onValueChange={(v) => {
                setChannel(v as Channel);
                setValue('');
                setFieldError(null);
              }}
            >
              <TabsList aria-labelledby="invite-channel">
                <TabsTrigger value="EMAIL">{t('invite.email')}</TabsTrigger>
                <TabsTrigger value="PHONE">{t('invite.phone')}</TabsTrigger>
                <TabsTrigger value="LINK">{t('invite.link')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {formError ? <Alert variant="destructive" title={formError} /> : null}
          {channel !== 'LINK' ? (
            <FormField
              id="invite-value"
              label={channel === 'EMAIL' ? t('invite.emailLabel') : t('invite.phoneLabel')}
              error={fieldError ?? undefined}
              required
            >
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                type={channel === 'EMAIL' ? 'email' : 'tel'}
                autoComplete="off"
                placeholder={channel === 'PHONE' ? '+237…' : undefined}
              />
            </FormField>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('pay.cancel')}
            </Button>
            <Button type="submit" variant="secondary" loading={pending}>
              {channel === 'LINK' ? t('invite.createLink') : t('invite.send')}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

/** Invitation d'un membre (admin, US-4.2) : e-mail, SMS ou lien partageable. */
export function InviteDialog({
  tontineId,
  variant = 'primary',
  className,
}: {
  tontineId: string;
  variant?: ButtonProps['variant'];
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} className={className}>
          <UserPlus aria-hidden="true" /> {t('tontine.invite')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {open ? <InviteContent tontineId={tontineId} onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
