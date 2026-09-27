import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/errors';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        // Pas de nouvelle tentative sur les erreurs 4xx (404 = fonctionnalité absente, 403…)
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
