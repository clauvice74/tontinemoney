import { useAuthStore } from '../auth/store';
import { createApiClient } from './client';

export * from './client';
export * from './errors';
export type * from './types';

/**
 * Client API de l'application : appels relatifs `/api/v1/...` (même origine, rewrites Next.js),
 * jeton d'accès lu dans le store Zustand en mémoire.
 */
export const api = createApiClient({
  getAccessToken: () => useAuthStore.getState().accessToken,
  setAccessToken: (token) => useAuthStore.getState().setAccessToken(token),
  onSessionExpired: () => {
    if (useAuthStore.getState().status === 'authenticated') useAuthStore.getState().clear();
  },
});
