'use client';

import { ACCESS_REQUEST_STATUSES } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
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
import type { AccessRequestView, ListResponse } from '@/lib/api/types';
import { formatDate, formatDateTime, fullName } from '@/lib/format';
import { ACCESS_REQUEST_STATUS_LABELS } from '@/lib/labels';
import { ActionDialog } from './action-dialog';
import { QueryState } from './feedback';
import { StatusBadge } from './status-badge';

/**
 * Demandes d'accès : US-10.1 (super-admin, toutes les demandes) et US-2.4 (admin de tontine,
 * filtré par `tontineId`). Accepter, ou refuser avec motif obligatoire.
 */
export function AccessRequests({ tontineId }: { tontineId?: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>('PENDING');
  const key = ['access-requests', tontineId ?? 'all', status];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<ListResponse<AccessRequestView>>('/access-requests', {
        query: { tontineId, status },
      }),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['access-requests'] });

  return (
    <div className="space-y-4">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="ar-status">Statut</Label>
        <Select id="ar-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {ACCESS_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ACCESS_REQUEST_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={<p className="py-6 text-center text-sm text-muted-foreground">Aucune demande.</p>}
      >
        {(d) => (
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Demandeur</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Tontine</TableHead>
                    <TableHead>Reçue le</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{fullName(r.user)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="block">{r.user.email ?? '—'}</span>
                        <span className="block">{r.user.phone ?? ''}</span>
                      </TableCell>
                      <TableCell>
                        {r.targetTontine?.name ?? r.requestedTontineName ?? '—'}
                        {!r.targetTontine && r.requestedTontineName ? (
                          <span className="block text-xs text-muted-foreground">(souhaitée)</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(r.createdAt)}
                        <span className="block text-xs text-muted-foreground">
                          expire le {formatDate(r.expiresAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} labels={ACCESS_REQUEST_STATUS_LABELS} />
                        {r.decisionReason ? (
                          <span className="block text-xs text-muted-foreground">{r.decisionReason}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {r.status === 'PENDING' ? (
                          <div className="flex justify-end gap-2">
                            <ActionDialog
                              trigger="Accepter"
                              triggerVariant="default"
                              title={`Accepter la demande de ${fullName(r.user)} ?`}
                              description="Un lien ou code d’activation sera envoyé au demandeur."
                              confirmLabel="Accepter"
                              successMessage="Demande acceptée"
                              onConfirm={async () => {
                                await api.post(`/access-requests/${r.id}/decision`, {
                                  decision: 'APPROVE',
                                  ...(r.targetTontine?.id ?? tontineId
                                    ? { tontineId: r.targetTontine?.id ?? tontineId }
                                    : {}),
                                });
                                await invalidate();
                              }}
                            />
                            <ActionDialog
                              trigger="Refuser"
                              title={`Refuser la demande de ${fullName(r.user)} ?`}
                              description="Le demandeur sera informé du motif."
                              reason={{ label: 'Motif du refus', required: true }}
                              confirmVariant="destructive"
                              confirmLabel="Refuser"
                              successMessage="Demande refusée"
                              onConfirm={async (reason) => {
                                await api.post(`/access-requests/${r.id}/decision`, {
                                  decision: 'REJECT',
                                  reason,
                                });
                                await invalidate();
                              }}
                            />
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}
