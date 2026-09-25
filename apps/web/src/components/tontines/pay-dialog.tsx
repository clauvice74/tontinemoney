'use client';

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
  toast,
} from '@tontine/ui';
import { type ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import { NetworkError } from '@/lib/api/errors';
import { formatError } from '@/lib/forms';
import { useIdempotencyKey } from '@/lib/hooks/use-idempotency-key';
import { qk } from '@/lib/queries';

/**
 * Contenu monté à l'ouverture : la clé d'idempotence est générée à ce moment-là et réutilisée
 * si l'utilisateur renvoie après une erreur réseau.
 */
function PayContent({
  path,
  summary,
  onDone,
  successMessage,
}: {
  path: string;
  summary: ReactNode;
  onDone: () => void;
  successMessage: string;
}) {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function pay() {
    setPending(true);
    setError(null);
    try {
      await api.post(path, {}, { idempotencyKey: idem.key });
      idem.settle();
      toast.success(successMessage);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.wallet }),
        queryClient.invalidateQueries({ queryKey: qk.tontines }),
      ]);
      onDone();
    } catch (e) {
      idem.settle(e);
      setError(
        e instanceof NetworkError
          ? `${formatError(e)} Vous pouvez réessayer sans risque de double débit.`
          : formatError(e),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Confirmer le paiement</DialogTitle>
        <DialogDescription>Le montant sera débité de votre portefeuille.</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg bg-muted p-4 text-sm">{summary}</div>
      {error ? <Alert variant="destructive" title={error} /> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button onClick={() => void pay()} loading={pending}>
          Payer
        </Button>
      </DialogFooter>
    </>
  );
}

/** Bouton de paiement depuis le portefeuille (cotisation, droit d'entrée) — POST financier. */
export function PayDialog({
  label,
  path,
  summary,
  successMessage,
  variant = 'default',
  size = 'sm',
}: {
  label: string;
  path: string;
  summary: ReactNode;
  successMessage: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {open ? (
          <PayContent
            path={path}
            summary={summary}
            successMessage={successMessage}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
