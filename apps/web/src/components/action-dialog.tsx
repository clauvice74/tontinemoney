'use client';

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
  Textarea,
  toast,
} from '@tontine/ui';
import { type ReactNode, useId, useState } from 'react';
import { formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';

interface ActionDialogProps {
  /** Libellé du bouton déclencheur. */
  trigger: ReactNode;
  triggerVariant?: ButtonProps['variant'];
  triggerSize?: ButtonProps['size'];
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  confirmVariant?: ButtonProps['variant'];
  /** Demande un motif (obligatoire si `reasonRequired`). */
  reason?: { label: string; required?: boolean; minLength?: number; placeholder?: string };
  successMessage?: string;
  onConfirm: (reason: string) => Promise<unknown>;
  disabled?: boolean;
  /** Champs supplémentaires affichés dans la boîte de dialogue. */
  children?: ReactNode;
}

/**
 * Action sensible confirmée par une boîte de dialogue, avec motif optionnel ou obligatoire
 * (refus, suspension, annulation…).
 */
export function ActionDialog({
  trigger,
  triggerVariant = 'outline',
  triggerSize = 'sm',
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  reason,
  successMessage,
  onConfirm,
  disabled,
  children,
}: ActionDialogProps) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const minLength = reason?.minLength ?? (reason?.required ? 1 : 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reason && value.trim().length < minLength) {
      setFieldError(
        minLength > 1
          ? t('actionDialog.minLength', { count: minLength })
          : t('actionDialog.reasonRequired'),
      );
      return;
    }
    setFieldError(undefined);
    setPending(true);
    try {
      await onConfirm(value.trim());
      if (successMessage) toast.success(successMessage);
      setOpen(false);
      setValue('');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setFieldError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} disabled={disabled}>
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {reason ? (
            <FormField
              id={`${id}-reason`}
              label={reason.label}
              required={reason.required}
              error={fieldError}
            >
              <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={reason.placeholder}
                maxLength={1000}
              />
            </FormField>
          ) : null}
          {error ? <Alert variant="destructive" title={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('actionDialog.cancel')}
            </Button>
            <Button type="submit" variant={confirmVariant} loading={pending}>
              {confirmLabel ?? t('actionDialog.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
