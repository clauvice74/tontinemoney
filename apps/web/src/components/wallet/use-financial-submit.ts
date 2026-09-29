'use client';

import { useState } from 'react';
import { type FieldValues, type UseFormSetError } from 'react-hook-form';
import { NetworkError } from '@/lib/api/errors';
import { applyServerErrors, formatError } from '@/lib/forms';
import { useIdempotencyKey } from '@/lib/hooks/use-idempotency-key';
import { useI18n } from '@/lib/i18n';

/**
 * Soumission d'une opération financière : même clé d'idempotence tant que la demande n'a pas
 * abouti (une erreur réseau peut être renvoyée sans risque de doublon), erreurs sur les champs.
 */
export function useFinancialSubmit<TValues extends FieldValues>(
  setError: UseFormSetError<TValues>,
  fields: readonly string[],
) {
  const { t } = useI18n();
  const idem = useIdempotencyKey();
  const [formError, setFormError] = useState<string | null>(null);

  async function run<T>(fn: (key: string) => Promise<T>): Promise<T | undefined> {
    setFormError(null);
    try {
      const res = await fn(idem.key);
      idem.settle();
      return res;
    } catch (e) {
      idem.settle(e);
      setFormError(
        e instanceof NetworkError
          ? `${formatError(e)} ${t('wallet.retrySafe')}`
          : (applyServerErrors(e, setError, fields) ?? null),
      );
      return undefined;
    }
  }

  return { run, formError, setFormError };
}
