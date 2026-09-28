'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent, toast } from '@tontine/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Section } from '@/components/page-header';
import { api } from '@/lib/api';
import type { ListResponse, ParticipantView } from '@/lib/api/types';
import { formatError } from '@/lib/forms';
import { useTontine } from '@/lib/queries';

function OrderEditor({ tontineId, initial }: { tontineId: string; initial: ParticipantView[] }) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState(() =>
    [...initial].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
  );
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState('');

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    setOrder(next);
    setAnnounce(`${item.firstName} déplacé en position ${target + 1}`);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/tontines/${tontineId}/draw-order`, {
        memberIds: order.map((p) => p.memberId),
      });
      toast.success('Ordre de passage enregistré');
      await queryClient.invalidateQueries({ queryKey: ['tontines', tontineId, 'participants'] });
    } catch (e) {
      toast.error('Enregistrement impossible', formatError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <ol className="space-y-2">
        {order.map((p, i) => (
          <li key={p.memberId} className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <span className="grid size-8 place-items-center rounded-full bg-secondary text-sm font-medium tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 font-medium">{p.firstName}</span>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={`Monter ${p.firstName}`}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => move(i, 1)}
              disabled={i === order.length - 1}
              aria-label={`Descendre ${p.firstName}`}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <Button onClick={() => void save()} loading={saving} disabled={order.length < 3}>
        Enregistrer l’ordre
      </Button>
    </div>
  );
}

/** Ordre de passage (FIXED_ORDER) — ne s'applique qu'aux cycles futurs (R-TON-08). */
export default function DrawOrderPage() {
  const { id } = useParams<{ id: string }>();
  const tontine = useTontine(id);
  const participants = useQuery({
    queryKey: ['tontines', id, 'participants'],
    queryFn: () =>
      api.get<ListResponse<ParticipantView> | ParticipantView[]>(`/tontines/${id}/participants`),
    select: (d) => (Array.isArray(d) ? d : d.data),
  });

  return (
    <Section
      title="Ordre de passage"
      description="Définissez l’ordre des bénéficiaires. Les modifications ne concernent que les cycles à venir."
    >
      {tontine.data && tontine.data.drawMode !== 'FIXED_ORDER' ? (
        <Alert variant="info" title="Non applicable">
          Cette tontine n’utilise pas le mode « ordre fixe ».
        </Alert>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <QueryState
              query={participants}
              isEmpty={(d) => d.length === 0}
              empty={<p className="text-sm text-muted-foreground">Aucun participant.</p>}
            >
              {(list) => <OrderEditor tontineId={id} initial={list} />}
            </QueryState>
          </CardContent>
        </Card>
      )}
    </Section>
  );
}
