import { z } from 'zod';

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; limit: number };
  meta?: Record<string, unknown>;
}

/** Curseur opaque : `(valeur de tri, id)` encodé en base64url. */
export interface CursorPayload {
  k: string | number | null;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as { id: unknown }).id === 'string'
    ) {
      const p = parsed as { id: string; k?: unknown };
      const k = typeof p.k === 'string' || typeof p.k === 'number' ? p.k : null;
      return { id: p.id, k };
    }
    return null;
  } catch {
    return null;
  }
}

/** Construit une page à partir de `limit + 1` lignes lues. */
export function buildPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortKey: (row: T) => string | number | null,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ k: sortKey(last), id: last.id }) : null,
  };
}
