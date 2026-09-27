import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from './api/errors';

/**
 * Reporte les erreurs d'un Problem Details (`errors[].path`) sur les champs du formulaire.
 * Renvoie le message global à afficher (erreurs non rattachées à un champ connu), ou null.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields?: readonly string[],
): string | null {
  if (!(error instanceof ApiError)) return formatError(error);
  const fields = error.fieldErrors;
  const entries = Object.entries(fields);
  let unmatched = false;
  for (const [path, message] of entries) {
    if (!knownFields || knownFields.some((f) => path === f || path.startsWith(`${f}.`))) {
      setError(path as Path<T>, { type: 'server', message });
    } else {
      unmatched = true;
    }
  }
  if (entries.length === 0 || unmatched) return formatError(error);
  return null;
}

export function formatError(error: unknown): string {
  const { title, detail } = errorMessage(error);
  return detail ? `${title} — ${detail}` : title;
}

/** Convertit une chaîne vide en `undefined` (champs optionnels RHF → zod). */
export function emptyToUndefined(value: unknown): unknown {
  return value === '' || value === null ? undefined : value;
}

/** Convertit une saisie numérique (valueAsNumber) en `undefined` si vide. */
export function numberOrUndefined(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? undefined : n;
}
