import { api } from '../api';
import type { LoginTokens, Me } from '../api/types';
import { useAuthStore } from './store';

/** Charge le compte courant et marque la session comme authentifiée. */
export async function loadCurrentUser(): Promise<Me> {
  const me = await api.get<Me>('/auth/me');
  useAuthStore.getState().setUser(me);
  return me;
}

/** Enregistre les jetons reçus à la connexion (le refresh token reste en cookie HttpOnly). */
export async function completeLogin(tokens: Pick<LoginTokens, 'accessToken'>): Promise<Me> {
  useAuthStore.getState().setAccessToken(tokens.accessToken);
  return loadCurrentUser();
}

let bootstrapPromise: Promise<void> | null = null;

/**
 * Restauration silencieuse de la session au démarrage : tente un rafraîchissement via le cookie
 * `tm_rt`. Idempotent (React StrictMode appelle les effets deux fois).
 */
export function bootstrapSession(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const state = useAuthStore.getState();
    if (state.status === 'authenticated') return;
    try {
      const token = state.accessToken ?? (await api.refresh());
      if (!token) {
        useAuthStore.getState().clear();
        return;
      }
      await loadCurrentUser();
    } catch {
      useAuthStore.getState().clear();
    }
  })().finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // la session locale est détruite quoi qu'il arrive
  } finally {
    useAuthStore.getState().clear();
  }
}
