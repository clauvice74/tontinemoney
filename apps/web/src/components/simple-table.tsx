import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tontine/ui';
import type { ReactNode } from 'react';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** En-tête visuellement masqué (colonne d'actions). */
  srOnlyHeader?: boolean;
}

/** Tableau déclaratif pour les listes d'administration. */
export function SimpleTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption?: string;
}) {
  return (
    <Table>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.header} className={c.className}>
              {c.srOnlyHeader ? <span className="sr-only">{c.header}</span> : c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={rowKey(r)}>
            {columns.map((c) => (
              <TableCell key={c.header} className={c.className}>
                {c.cell(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
