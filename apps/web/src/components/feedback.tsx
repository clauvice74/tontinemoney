'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { Alert, Button, EmptyState, LoadingBlock } from '@tontine/ui';
import { Hourglass, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '@/lib/api/errors';

/** État vide pour les fonctionnalités dont la route API n'est pas encore disponible (404). */
export function ComingSoon({ title, description }: { title?: string; description?: ReactNode }) {
  return (
    <EmptyState
      icon={<Hourglass aria-hidden="true" />}
      title={title ?? 'Fonctionnalité bientôt disponible'}
      description={
        description ??
        'Ce service n’est pas encore ouvert sur la plateforme. Il sera activé prochainement.'
      }
    />
  );
}

export function ErrorAlert({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const { title, detail } = errorMessage(error);
  const mfa = error instanceof ApiError && error.code === 'MFA_REQUIRED';
  return (
    <Alert variant={mfa ? 'warning' : 'destructive'} title={title} className={className}>
      {detail ? <p>{detail}</p> : null}
      {mfa ? (
        <p className="mt-2">
          <Link className="font-medium text-primary underline" href="/security">
            Aller aux paramètres de sécurité
          </Link>
        </p>
      ) : null}
      {onRetry && !mfa ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Réessayer
        </Button>
      ) : null}
      {error instanceof ApiError && error.correlationId ? (
        <p className="mt-1 text-xs text-muted-foreground">Référence : {error.correlationId}</p>
      ) : null}
    </Alert>
  );
}

export function isComingSoon(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

interface QueryStateProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'isError'> & {
    refetch: () => unknown;
  };
  children: (data: T) => ReactNode;
  /** Rendu du chargement (défaut : Skeleton). */
  loading?: ReactNode;
  /** Traite un 404 comme « fonctionnalité bientôt disponible » (défaut : true). */
  notFoundAsComingSoon?: boolean;
  comingSoonTitle?: string;
  /** Prédicat d'état vide et rendu associé. */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
}

/** Gère chargement / erreur / 404 / vide d'une requête TanStack Query. */
export function QueryState<T>({
  query,
  children,
  loading,
  notFoundAsComingSoon = true,
  comingSoonTitle,
  isEmpty,
  empty,
}: QueryStateProps<T>) {
  if (query.isPending) return <>{loading ?? <LoadingBlock />}</>;
  if (query.isError) {
    if (notFoundAsComingSoon && isComingSoon(query.error)) {
      return <ComingSoon {...(comingSoonTitle ? { title: comingSoonTitle } : {})} />;
    }
    if (query.error instanceof ApiError && query.error.status === 403) {
      return (
        <EmptyState
          icon={<ShieldAlert aria-hidden="true" />}
          title="Accès refusé"
          description="Vous n’avez pas les droits nécessaires pour consulter cette page."
        />
      );
    }
    return <ErrorAlert error={query.error} onRetry={() => void query.refetch()} />;
  }
  const data = query.data as T;
  if (isEmpty && empty && isEmpty(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}
