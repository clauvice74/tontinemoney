'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, Input, Label } from '@tontine/ui';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import type { DevMessage, ListResponse } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

/** Transforme les URL présentes dans un message en liens cliquables. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} className="font-medium text-primary underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

export function DevMessages() {
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState('');
  const query = useQuery({
    queryKey: ['dev-messages', filter],
    queryFn: () =>
      api.get<ListResponse<DevMessage>>('/dev/messages', {
        query: { to: filter || undefined, limit: 50 },
        auth: false,
      }),
    refetchInterval: 5_000,
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title="Messages simulés"
        description="SMS et emails émis par la plateforme en développement (codes OTP, liens d’activation, réinitialisation…). Actualisation toutes les 5 s."
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden="true" /> Actualiser
          </Button>
        }
      />
      <Alert variant="warning" title="Environnement de développement uniquement" className="mb-4">
        Cette page n’existe pas en production.
      </Alert>
      <form
        className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(to.trim());
        }}
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="dev-to">Destinataire (email ou téléphone)</Label>
          <Input id="dev-to" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit">Filtrer</Button>
      </form>
      <QueryState
        query={query}
        isEmpty={(d) => d.data.length === 0}
        empty={<p className="text-sm text-muted-foreground">Aucun message.</p>}
      >
        {(d) => (
          <ul className="space-y-3">
            {d.data.map((m) => (
              <li key={m.id}>
                <Card>
                  <CardContent className="space-y-2 pt-5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={m.channel === 'SMS' ? 'info' : 'secondary'}>{m.channel}</Badge>
                      <span className="font-medium">{m.to}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </span>
                    </div>
                    {m.subject ? <p className="font-semibold">{m.subject}</p> : null}
                    <Linkified text={m.body} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
