'use client';

import { PLATFORM_ROLES, USER_STATUSES } from '@tontine/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Input, Label, Select } from '@tontine/ui';
import { Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminUserView, ListResponse } from '@/lib/api/types';
import { formatDate, formatDateTime, fullName } from '@/lib/format';
import { ROLE_LABELS, USER_STATUS_LABELS, label } from '@/lib/labels';
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
          <Label htmlFor="users-search">Recherche</Label>
          <div className="flex gap-2">
            <Input
              id="users-search"
              type="search"
              placeholder="Nom, email ou téléphone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" aria-label="Rechercher">
              <Search aria-hidden="true" />
            </Button>
          </div>
        </div>
        {!fixedRole ? (
          <div className="space-y-1.5">
            <Label htmlFor="users-role">Rôle</Label>
            <Select
              id="users-role"
              value={filters.role}
              onChange={(e) => setFilters({ ...filters, role: e.target.value })}
            >
              <option value="">Tous</option>
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="users-status">Statut</Label>
          <Select
            id="users-status"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Tous</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {USER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </form>
      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <p className="py-6 text-center text-sm text-muted-foreground">Aucun compte trouvé.</p>
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
                    header: 'Nom',
                    cell: (u) => <span className="font-medium">{fullName(u)}</span>,
                  },
                  {
                    header: 'Contact',
                    cell: (u) => (
                      <span className="text-muted-foreground">
                        <span className="block">{u.email ?? '—'}</span>
                        <span className="block">{u.phone ?? ''}</span>
                      </span>
                    ),
                  },
                  { header: 'Rôle', cell: (u) => label(ROLE_LABELS, u.role) },
                  {
                    header: 'Statut',
                    cell: (u) => (
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge status={u.status} labels={USER_STATUS_LABELS} />
                        {u.locked ? <Badge variant="destructive">Verrouillé</Badge> : null}
                        {u.mfaEnabled ? <Badge variant="outline">MFA</Badge> : null}
                      </span>
                    ),
                  },
                  { header: 'Créé le', cell: (u) => formatDate(u.createdAt) },
                  { header: 'Dernière connexion', cell: (u) => formatDateTime(u.lastLoginAt) },
                  { header: 'Actions', srOnlyHeader: true, className: 'text-right', cell: actions },
                ]}
              />
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
