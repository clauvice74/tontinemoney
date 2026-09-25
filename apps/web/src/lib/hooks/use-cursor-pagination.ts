'use client';

import { useCallback, useState } from 'react';

/**
 * Pile de curseurs pour la pagination opaque de l'API (`page.nextCursor`).
 * `cursor` est le curseur de la page affichée (undefined = première page).
 */
export function useCursorPagination() {
  const [stack, setStack] = useState<Array<string | undefined>>([undefined]);
  const index = stack.length - 1;
  const cursor = stack[index];

  const next = useCallback((nextCursor: string | null | undefined) => {
    if (!nextCursor) return;
    setStack((s) => [...s, nextCursor]);
  }, []);

  const previous = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const reset = useCallback(() => setStack([undefined]), []);

  return { cursor, page: index + 1, hasPrevious: index > 0, next, previous, reset };
}
