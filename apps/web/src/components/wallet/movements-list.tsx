'use client';

import { MOVEMENT_TYPES } from '@tontine/contracts';
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
  cn,
} from '@tontine/ui';
import { ArrowDownLeft, ArrowUpRight, Lock, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { ListResponse, MovementView } from '@/lib/api/types';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { Amount } from '../amount';
import { QueryState } from '../feedback';

interface Filters {
  type: string;
  context: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { type: '', context: '', from: '', to: '' };

/** Filtres rapides : les opérations les plus fréquentes. */
const QUICK_CONTEXTS = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'TONTINE_CONTRIBUTION',
  'TONTINE_PAYOUT',
] as const;

function signed(m: MovementView) {
  return m.direction === 'IN'
    ? { signed: 'in' as const }
    : m.direction === 'OUT'
      ? { signed: 'out' as const }
      : {};
}

function MovementIcon({ m }: { m: MovementView }) {
  const Icon = m.direction === 'IN' ? ArrowDownLeft : m.direction === 'OUT' ? ArrowUpRight : Lock;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full',
        m.direction === 'IN' ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** Historique paginé (curseur) et filtrable des mouvements du wallet (US-5.2). */
export function MovementsList() {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [advanced, setAdvanced] = useState(false);
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['wallet-movements', filters, pagination.cursor],
    queryFn: () =>
      api.get<ListResponse<MovementView>>('/me/wallet/movements', {
        query: { limit: 20, cursor: pagination.cursor, ...filters },
      }),
    placeholderData: keepPreviousData,
  });

  function applyFilters(next: Filters) {
    setDraft(next);
    setFilters(next);
    pagination.reset();
  }

  const title = (m: MovementView) =>
    labels.movementContext[m.context] ?? m.contextLabel ?? m.context;

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('wallet.filters')}
      >
        {(['', ...QUICK_CONTEXTS] as const).map((c) => {
          const active = filters.context === c;
          return (
            <button
              key={c || 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => applyFilters({ ...filters, context: c })}
              className={cn(
                'h-8 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted',
              )}
            >
              {c ? labels.movementContext[c] : t('wallet.all')}
            </button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={advanced}
          aria-controls="mv-advanced"
          onClick={() => setAdvanced((a) => !a)}
        >
          <SlidersHorizontal aria-hidden="true" /> {t('wallet.moreFilters')}
        </Button>
      </div>

      {advanced ? (
        <form
          id="mv-advanced"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters(draft);
          }}
          className="grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          aria-label={t('wallet.filters')}
        >
          <div className="space-y-1.5">
            <Label htmlFor="mv-type">{t('wallet.type')}</Label>
            <Select
              id="mv-type"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            >
              <option value="">{t('wallet.all')}</option>
              {MOVEMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {labels.movementType[x] ?? x}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mv-from">{t('wallet.from')}</Label>
            <Input
              id="mv-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mv-to">{t('wallet.to')}</Label>
            <Input
              id="mv-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1">
              {t('wallet.apply')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => applyFilters(EMPTY)}>
              {t('wallet.clear')}
            </Button>
          </div>
        </form>
      ) : null}

      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <p className="py-6 text-center text-sm text-muted-foreground">{t('wallet.empty')}</p>
        }
      >
        {(d) => (
          <>
            {/* Mobile : liste compacte */}
            <ul className="divide-y rounded-md border md:hidden">
              {d.data.map((m) => (
                <li key={m.id} className="flex items-center gap-3 p-3">
                  <MovementIcon m={m} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{title(m)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.dateTime(m.createdAt)}
                      {m.contextLabel ? ` · ${m.contextLabel}` : ''}
                    </p>
                  </div>
                  <Amount value={m.amount} {...signed(m)} />
                </li>
              ))}
            </ul>
            {/* Ordinateur : tableau complet */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('wallet.date')}</TableHead>
                  <TableHead>{t('wallet.operation')}</TableHead>
                  <TableHead>{t('wallet.detail')}</TableHead>
                  <TableHead className="text-right">{t('wallet.amount')}</TableHead>
                  <TableHead className="text-right">{t('wallet.balanceAfter')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.data.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {f.dateTime(m.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{title(m)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {labels.movementType[m.type] ?? m.type}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {m.contextLabel ?? m.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount value={m.amount} {...signed(m)} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <Amount value={m.balanceAfter} />
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
