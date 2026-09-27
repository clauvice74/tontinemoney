'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '../api/errors';

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Clé d'idempotence d'un formulaire financier : générée à l'ouverture du formulaire,
 * **conservée** si la soumission échoue sur une erreur réseau (le serveur a peut-être traité
 * la requête : la rejouer avec la même clé évite un double débit), renouvelée après un succès
 * ou une réponse d'erreur définitive du serveur.
 */
export function useIdempotencyKey() {
  const [key, setKey] = useState<string>(newKey);

  const renew = useCallback(() => setKey(newKey()), []);

  /** À appeler après chaque tentative pour décider de conserver ou renouveler la clé. */
  const settle = useCallback((error?: unknown) => {
    if (!error) {
      setKey(newKey());
      return;
    }
    if (error instanceof ApiError && error.code !== 'IDEMPOTENCY_IN_PROGRESS') {
      setKey(newKey());
    }
    // NetworkError ou requête en cours côté serveur : on garde la même clé.
  }, []);

  return { key, renew, settle };
}
