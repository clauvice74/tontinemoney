import { create } from 'zustand';
import type { Me } from '../api/types';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  /** Jeton d'accès JWT — en mémoire uniquement (jamais localStorage/sessionStorage). */
  accessToken: string | null;
  user: Me | null;
  status: SessionStatus;
  setAccessToken: (token: string | null) => void;
  setUser: (user: Me) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  status: 'unknown',
  setAccessToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user, status: 'authenticated' }),
  clear: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}));
