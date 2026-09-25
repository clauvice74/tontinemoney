'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ListResponse, NotificationView, TontineView, WalletView } from './api/types';
import { useAuthStore } from './auth/store';

/** Clés de cache partagées. */
export const qk = {
  me: ['auth', 'me'] as const,
  tontines: ['tontines'] as const,
  tontine: (id: string) => ['tontines', id] as const,
  wallet: ['wallet'] as const,
  notifications: (unread?: boolean) => ['notifications', { unread: !!unread }] as const,
  profile: ['profile'] as const,
};

export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}

/** Tontines dont je suis membre ou administrateur (404 toléré tant que l'API n'expose pas la route). */
export function useMyTontines() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: qk.tontines,
    queryFn: () => api.get<ListResponse<TontineView>>('/tontines'),
    enabled: status === 'authenticated',
  });
}

export function useTontine(id: string) {
  return useQuery({
    queryKey: qk.tontine(id),
    queryFn: () => api.get<TontineView>(`/tontines/${id}`),
    enabled: !!id,
  });
}

export function useWallet() {
  return useQuery({ queryKey: qk.wallet, queryFn: () => api.get<WalletView>('/me/wallet') });
}

export function useUnreadCount() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: qk.notifications(true),
    queryFn: () =>
      api.get<ListResponse<NotificationView, { unread: number }>>('/me/notifications', {
        query: { unread: 'true', limit: 5 },
      }),
    enabled: status === 'authenticated',
    refetchInterval: 60_000,
    select: (d) => d.meta?.unread ?? 0,
  });
}

/** Tontines que j'administre (myRole = ADMIN). */
export function useAdminTontines() {
  const q = useMyTontines();
  return { ...q, data: q.data?.data.filter((t) => t.myRole === 'ADMIN') ?? [] };
}
