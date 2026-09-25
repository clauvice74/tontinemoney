'use client';

import { KYC_LEVELS, MEMBER_STATUSES } from '@tontine/contracts';
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
import { Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import type { ListResponse, MemberRow, MembersMeta } from '@/lib/api/types';
import { formatDate, formatRelative } from '@/lib/format';
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';
import {
  KYC_LEVEL_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  MEMBER_STATUS_LABELS,
  label,
} from '@/lib/labels';
import { QueryState } from '../feedback';
import { StatusBadge } from '../status-badge';

export const MEMBER_SORTS = {
  name_asc: 'Nom (A → Z)',
  name_desc: 'Nom (Z → A)',
  registered_desc: 'Inscription (récentes)',
  registered_asc: 'Inscription (anciennes)',
  status: 'Statut',
} as const;

export interface MemberFilters {
  status: string;
  kycLevel: string;
  registeredFrom: string;
  registeredTo: string;
  search: string;
  sort: keyof typeof MEMBER_SORTS;
  membership: 'ALL' | 'ACTIVE' | 'PENDING_APPROVAL';
}

const DEFAULT_FILTERS: MemberFilters = {
  status: '',
  kycLevel: '',
  registeredFrom: '',
  registeredTo: '',
  search: '',
  sort: 'name_asc',
  membership: 'ALL',
};

/**
 * Liste des membres d'une tontine (US-2.3) : pagination par curseur (20 / page), filtres
 * statut / KYC / dates, recherche partielle, tri, compteur ; coordonnées masquées par l'API.
 */
export function MembersTable({
  tontineId,
  rowActions,
}: {
  tontineId: string;
  rowActions?: (member: MemberRow) => ReactNode;
}) {
  const [draft, setDraft] = useState<MemberFilters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<MemberFilters>(DEFAULT_FILTERS);
  const pagination = useCursorPagination();

  const query = useQuery({
    queryKey: ['tontines', tontineId, 'members', filters, pagination.cursor],
    queryFn: () =>
      api.get<ListResponse<MemberRow, MembersMeta>>(`/tontines/${tontineId}/members`, {
        query: {
          limit: 20,
          cursor: pagination.cursor,
          status: filters.status,
          kycLevel: filters.kycLevel,
          registeredFrom: filters.registeredFrom,
          registeredTo: filters.registeredTo,
          search: filters.search.trim(),
          sort: filters.sort,
          membership: filters.membership,
        },
      }),
    placeholderData: keepPreviousData,
  });

  function apply(next: MemberFilters) {
    setFilters(next);
    pagination.reset();
  }

  return (
    <div className="space-y-4">
      <form
        role="search"
        aria-label="Filtrer les membres"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="members-search">Recherche</Label>
          <div className="flex gap-2">
            <Input
              id="members-search"
              type="search"
              placeholder="Nom, prénom, email ou téléphone"
              value={draft.search}
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            />
            <Button type="submit" aria-label="Rechercher">
              <Search aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-status">Statut</Label>
          <Select
            id="members-status"
            value={draft.status}
            onChange={(e) => apply({ ...draft, status: e.target.value })}
          >
            <option value="">Tous</option>
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MEMBER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-kyc">Niveau KYC</Label>
          <Select
            id="members-kyc"
            value={draft.kycLevel}
            onChange={(e) => apply({ ...draft, kycLevel: e.target.value })}
          >
            <option value="">Tous</option>
            {KYC_LEVELS.map((k) => (
              <option key={k} value={k}>
                {KYC_LEVEL_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-from">Inscrits du</Label>
          <Input
            id="members-from"
            type="date"
            value={draft.registeredFrom}
            onChange={(e) => apply({ ...draft, registeredFrom: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-to">au</Label>
          <Input
            id="members-to"
            type="date"
            value={draft.registeredTo}
            onChange={(e) => apply({ ...draft, registeredTo: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-sort">Tri</Label>
          <Select
            id="members-sort"
            value={draft.sort}
            onChange={(e) => apply({ ...draft, sort: e.target.value as MemberFilters['sort'] })}
          >
            {Object.entries(MEMBER_SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-membership">Adhésion</Label>
          <Select
            id="members-membership"
            value={draft.membership}
            onChange={(e) =>
              apply({ ...draft, membership: e.target.value as MemberFilters['membership'] })
            }
          >
            <option value="ALL">Toutes</option>
            <option value="ACTIVE">Actives</option>
            <option value="PENDING_APPROVAL">En attente de validation</option>
          </Select>
        </div>
      </form>

      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucun membre ne correspond à ces critères.
          </p>
        }
      >
        {(d) => (
          <>
            {d.meta?.summary ? (
              <p className="text-sm font-medium" aria-live="polite" data-testid="members-summary">
                {d.meta.summary}
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead>Adhésion</TableHead>
                  <TableHead>Inscription</TableHead>
                  <TableHead>Dernière activité</TableHead>
                  {rowActions ? (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.data.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.fullName}
                      {m.membershipRole === 'ADMIN' ? (
                        <span className="ml-1 text-xs text-muted-foreground">(admin)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block">{m.email ?? '—'}</span>
                      <span className="block">{m.phone ?? ''}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} labels={MEMBER_STATUS_LABELS} />
                    </TableCell>
                    <TableCell>{label(KYC_LEVEL_LABELS, m.kycLevel)}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.membershipStatus} labels={MEMBERSHIP_STATUS_LABELS} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(m.registeredAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {m.lastActivityAt ? formatRelative(m.lastActivityAt) : '—'}
                    </TableCell>
                    {rowActions ? (
                      <TableCell className="text-right">{rowActions(m)}</TableCell>
                    ) : null}
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
              info="20 par page"
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
