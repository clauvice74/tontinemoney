'use client';

import { MOVEMENT_CONTEXTS, MOVEMENT_TYPES } from '@tontine/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button,
  CursorPagination,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tontine/ui';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { ListResponse, MovementView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';
import { MOVEMENT_CONTEXT_LABELS, MOVEMENT_TYPE_LABELS, label } from '@/lib/labels';
import { QueryState } from '../feedback';
import { Money } from '../money';

interface Filters {
  type: string;
  context: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { type: '', context: '', from: '', to: '' };

/** Historique paginé (curseur) et filtrable des mouvements du portefeuille (US-5.2). */
export function MovementsTable() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['wallet-movements', filters, pagination.cursor],
    queryFn: () =>
      api.get<ListResponse<MovementView>>('/me/wallet/movements', {
        query: {
          limit: 20,
          cursor: pagination.cursor,
          type: filters.type,
          context: filters.context,
          from: filters.from,
          to: filters.to,
        },
      }),
    placeholderData: keepPreviousData,
  });

  function apply(e: React.FormEvent) {
    e.preventDefault();
    setFilters(draft);
    pagination.reset();
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={apply}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        aria-label="Filtrer l’historique"
      >
        <div className="space-y-1.5">
          <Label htmlFor="mv-type">Type</Label>
          <Select
            id="mv-type"
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            <option value="">Tous</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(MOVEMENT_TYPE_LABELS, t)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mv-context">Opération</Label>
          <Select
            id="mv-context"
            value={draft.context}
            onChange={(e) => setDraft({ ...draft, context: e.target.value })}
          >
            <option value="">Toutes</option>
            {MOVEMENT_CONTEXTS.map((c) => (
              <option key={c} value={c}>
                {label(MOVEMENT_CONTEXT_LABELS, c)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mv-from">Du</Label>
          <Input
            id="mv-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mv-to">Au</Label>
          <Input
            id="mv-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            Filtrer
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              pagination.reset();
            }}
          >
            Effacer
          </Button>
        </div>
      </form>

      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={<p className="py-6 text-center text-sm text-muted-foreground">Aucun mouvement.</p>}
      >
        {(d) => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Opération</TableHead>
                  <TableHead>Détail</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right">Solde après</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.data.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(m.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {label(MOVEMENT_CONTEXT_LABELS, m.context)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {label(MOVEMENT_TYPE_LABELS, m.type)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {m.contextLabel ?? m.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Money
                        value={m.amount}
                        {...(m.direction === 'IN'
                          ? { signed: 'in' as const }
                          : m.direction === 'OUT'
                            ? { signed: 'out' as const }
                            : {})}
                      />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <Money value={m.balanceAfter} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <CursorPagination
              page={pagination.page}
              hasPrevious={pagination.hasPrevious}
              hasNext={!!d.page?.nextCursor}
              onPrevious={pagination.previous}
              onNext={() => pagination.next(d.page?.nextCursor)}
              loading={query.isFetching}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
