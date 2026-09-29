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
import { useCursorPagination } from '@/lib/hooks/use-cursor-pagination';
import { type MessageKey, useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { QueryState } from '../feedback';
import { StatusBadge } from '../status-badge';

export const MEMBER_SORTS = [
  'name_asc',
  'name_desc',
  'registered_desc',
  'registered_asc',
  'status',
] as const;

export interface MemberFilters {
  status: string;
  kycLevel: string;
  registeredFrom: string;
  registeredTo: string;
  search: string;
  sort: (typeof MEMBER_SORTS)[number];
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
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
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
        aria-label={t('adminT.members.filtersLabel')}
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="members-search">{t('adminT.members.search')}</Label>
          <div className="flex gap-2">
            <Input
              id="members-search"
              type="search"
              placeholder={t('adminT.members.searchPlaceholder')}
              value={draft.search}
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            />
            <Button type="submit" variant="secondary" aria-label={t('adminT.members.searchButton')}>
              <Search aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-status">{t('adminT.members.status')}</Label>
          <Select
            id="members-status"
            value={draft.status}
            onChange={(e) => apply({ ...draft, status: e.target.value })}
          >
            <option value="">{t('adminT.members.all')}</option>
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labels.memberStatus[s] ?? s}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-kyc">{t('adminT.members.kyc')}</Label>
          <Select
            id="members-kyc"
            value={draft.kycLevel}
            onChange={(e) => apply({ ...draft, kycLevel: e.target.value })}
          >
            <option value="">{t('adminT.members.all')}</option>
            {KYC_LEVELS.map((k) => (
              <option key={k} value={k}>
                {labels.kycLevel[k] ?? k}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-from">{t('adminT.members.from')}</Label>
          <Input
            id="members-from"
            type="date"
            value={draft.registeredFrom}
            onChange={(e) => apply({ ...draft, registeredFrom: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-to">{t('adminT.members.to')}</Label>
          <Input
            id="members-to"
            type="date"
            value={draft.registeredTo}
            onChange={(e) => apply({ ...draft, registeredTo: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-sort">{t('adminT.members.sort')}</Label>
          <Select
            id="members-sort"
            value={draft.sort}
            onChange={(e) => apply({ ...draft, sort: e.target.value as MemberFilters['sort'] })}
          >
            {MEMBER_SORTS.map((k) => (
              <option key={k} value={k}>
                {t(`adminT.members.sorts.${k}` as MessageKey)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-membership">{t('adminT.members.membership')}</Label>
          <Select
            id="members-membership"
            value={draft.membership}
            onChange={(e) =>
              apply({ ...draft, membership: e.target.value as MemberFilters['membership'] })
            }
          >
            <option value="ALL">{t('adminT.members.membershipAll')}</option>
            <option value="ACTIVE">{t('adminT.members.membershipActive')}</option>
            <option value="PENDING_APPROVAL">{t('adminT.members.membershipPending')}</option>
          </Select>
        </div>
      </form>

      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('adminT.members.empty')}
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
            {/* Mobile : cartes */}
            <ul className="divide-y rounded-md border md:hidden">
              {d.data.map((m) => (
                <li key={m.id} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">
                      {m.fullName}
                      {m.membershipRole === 'ADMIN' ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({t('adminT.members.admin')})
                        </span>
                      ) : null}
                    </p>
                    <StatusBadge status={m.status} labels={labels.memberStatus} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[m.email, m.phone].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span>{labels.kycLevel[m.kycLevel] ?? m.kycLevel}</span>
                    <StatusBadge status={m.membershipStatus} labels={labels.membershipStatus} />
                    <span className="text-muted-foreground">{f.date(m.registeredAt)}</span>
                  </div>
                  {rowActions ? <div>{rowActions(m)}</div> : null}
                </li>
              ))}
            </ul>
            {/* Ordinateur : tableau */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('adminT.members.colName')}</TableHead>
                  <TableHead>{t('adminT.members.colContact')}</TableHead>
                  <TableHead>{t('adminT.members.colStatus')}</TableHead>
                  <TableHead>{t('adminT.members.colKyc')}</TableHead>
                  <TableHead>{t('adminT.members.colMembership')}</TableHead>
                  <TableHead>{t('adminT.members.colRegistered')}</TableHead>
                  <TableHead>{t('adminT.members.colActivity')}</TableHead>
                  {rowActions ? (
                    <TableHead>
                      <span className="sr-only">{t('adminT.members.actions')}</span>
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
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({t('adminT.members.admin')})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block">{m.email ?? '—'}</span>
                      <span className="block">{m.phone ?? ''}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} labels={labels.memberStatus} />
                    </TableCell>
                    <TableCell>{labels.kycLevel[m.kycLevel] ?? m.kycLevel}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.membershipStatus} labels={labels.membershipStatus} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{f.date(m.registeredAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {m.lastActivityAt ? f.relative(m.lastActivityAt) : '—'}
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
              info={t('adminT.members.perPage')}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
