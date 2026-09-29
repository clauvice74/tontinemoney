'use client';

import { PLATFORM_ROLES, USER_STATUSES } from '@tontine/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, Label, Select } from '@tontine/ui';
import { Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminUserView, ListResponse } from '@/lib/api/types';
import { fullName } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { QueryState } from '../feedback';
import { SimpleTable } from '../simple-table';
import { StatusBadge } from '../status-badge';

/** Recherche de comptes (super-admin) avec actions par ligne. */
export function UsersList({
  fixedRole,
  actions,
}: {
  fixedRole?: string;
  actions: (user: AdminUserView) => ReactNode;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const labels = useLabels();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', role: fixedRole ?? '', status: '' });
  const query = useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: () =>
      api.get<ListResponse<AdminUserView>>('/admin/users', {
        query: {
          search: filters.search || undefined,
          role: filters.role,
          status: filters.status,
          limit: 50,
        },
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <form
        role="search"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, search: search.trim() });
        }}
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="users-search">{t('platform.users.search')}</Label>
          <div className="flex gap-2">
            <Input
              id="users-search"
              type="search"
              placeholder={t('platform.users.placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" variant="secondary" aria-label={t('platform.users.searchButton')}>
              <Search aria-hidden="true" />
            </Button>
          </div>
        </div>
        {!fixedRole ? (
          <div className="space-y-1.5">
            <Label htmlFor="users-role">{t('platform.users.role')}</Label>
            <Select
              id="users-role"
              value={filters.role}
              onChange={(e) => setFilters({ ...filters, role: e.target.value })}
            >
              <option value="">{t('platform.users.all')}</option>
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {labels.role[r] ?? r}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="users-status">{t('platform.users.status')}</Label>
          <Select
            id="users-status"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">{t('platform.users.all')}</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labels.userStatus[s] ?? s}
              </option>
            ))}
          </Select>
        </div>
      </form>
      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('platform.users.empty')}
          </p>
        }
      >
        {(d) => (
          <Card>
            <CardContent className="pt-4">
              <SimpleTable
                rows={d.data}
                rowKey={(u) => u.id}
                columns={[
                  {
                    header: t('platform.users.colName'),
                    cell: (u) => <span className="font-medium">{fullName(u)}</span>,
                  },
                  {
                    header: t('platform.users.colContact'),
                    cell: (u) => (
                      <span className="text-muted-foreground">
                        <span className="block">{u.email ?? '—'}</span>
                        <span className="block">{u.phone ?? ''}</span>
                      </span>
                    ),
                  },
                  {
                    header: t('platform.users.colRole'),
                    cell: (u) => labels.role[u.role] ?? u.role,
                  },
                  {
                    header: t('platform.users.colStatus'),
                    cell: (u) => (
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge status={u.status} labels={labels.userStatus} />
                        {u.locked ? (
                          <Badge variant="destructive">{t('platform.users.locked')}</Badge>
                        ) : null}
                        {u.mfaEnabled ? <Badge variant="outline">MFA</Badge> : null}
                      </span>
                    ),
                  },
                  { header: t('platform.users.colCreated'), cell: (u) => f.date(u.createdAt) },
                  {
                    header: t('platform.users.colLastLogin'),
                    cell: (u) => f.dateTime(u.lastLoginAt),
                  },
                  {
                    header: t('platform.users.actions'),
                    srOnlyHeader: true,
                    className: 'text-right',
                    cell: actions,
                  },
                ]}
              />
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
