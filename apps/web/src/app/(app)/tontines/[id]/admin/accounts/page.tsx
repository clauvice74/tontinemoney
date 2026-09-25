'use client';

import { TONTINE_ACCOUNT_TYPES } from '@tontine/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LoadingBlock,
} from '@tontine/ui';
import { Landmark, PiggyBank, HandCoins, HeartHandshake } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ErrorAlert, isComingSoon } from '@/components/feedback';
import { Money } from '@/components/money';
import { Section } from '@/components/page-header';
import { api } from '@/lib/api';
import type { ListResponse, TontineAccountView } from '@/lib/api/types';
import { ACCOUNT_TYPE_LABELS } from '@/lib/labels';

const ICONS = { MAIN: Landmark, SOLIDARITY: HeartHandshake, SAVINGS: PiggyBank, LOAN: HandCoins };
const DESCRIPTIONS: Record<string, string> = {
  MAIN: 'Reçoit les cotisations et verse le pot au bénéficiaire de chaque cycle.',
  SOLIDARITY: 'Caisse d’entraide alimentée par une part des cotisations.',
  SAVINGS: 'Épargne collective rémunérée, avec conditions de sortie.',
  LOAN: 'Prêts aux membres à partir de l’épargne commune.',
};

/** Comptes de la tontine (US-10.2) : seul le compte principal est opérationnel en V1. */
export default function TontineAccountsPage() {
  const { id } = useParams<{ id: string }>();
  const accounts = useQuery({
    queryKey: ['tontines', id, 'accounts'],
    queryFn: () => api.get<ListResponse<TontineAccountView>>(`/tontines/${id}/accounts`),
  });
  const byType = new Map((accounts.data?.data ?? []).map((a) => [a.type, a]));

  return (
    <Section
      title="Comptes de la tontine"
      description="Le compte principal est actif ; les autres types de comptes arrivent bientôt."
    >
      {accounts.isError && !isComingSoon(accounts.error) ? (
        <ErrorAlert error={accounts.error} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {TONTINE_ACCOUNT_TYPES.map((type) => {
          const Icon = ICONS[type];
          const account = byType.get(type);
          const available = type === 'MAIN';
          return (
            <Card
              key={type}
              className={available ? '' : 'opacity-75'}
              aria-disabled={!available || undefined}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="size-5 text-primary" aria-hidden="true" />
                    {account?.name ?? ACCOUNT_TYPE_LABELS[type]}
                  </CardTitle>
                  {available ? (
                    <Badge variant="success">Actif</Badge>
                  ) : (
                    <Badge variant="muted">Bientôt</Badge>
                  )}
                </div>
                <CardDescription>{DESCRIPTIONS[type]}</CardDescription>
              </CardHeader>
              <CardContent>
                {available ? (
                  accounts.isPending ? (
                    <LoadingBlock lines={1} />
                  ) : account?.balance ? (
                    <p className="text-2xl font-semibold">
                      <Money value={account.balance} />
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Solde disponible dans le tableau de bord de la tontine.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Fonctionnalité bientôt disponible.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
