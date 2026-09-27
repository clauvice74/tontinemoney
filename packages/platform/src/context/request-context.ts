import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { type PlatformRole } from '@tontine/contracts';

export interface Actor {
  userId: string;
  role: PlatformRole;
  sessionId: string;
  tontineIds: string[];
  jti: string;
  tokenExp: number;
  /** Vrai si la session a été ouverte avec un second facteur. */
  mfa: boolean;
}

export interface RequestContextData {
  correlationId: string;
  causationId: string | null;
  actor: Actor | null;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  source: 'http' | 'event' | 'job' | 'system';
}

const storage = new AsyncLocalStorage<RequestContextData>();

/** Contexte de requête propagé (corrélation, acteur, métadonnées d'audit). */
export const RequestContext = {
  run<T>(data: Partial<RequestContextData>, fn: () => T): T {
    const full: RequestContextData = {
      correlationId: data.correlationId ?? randomUUID(),
      causationId: data.causationId ?? null,
      actor: data.actor ?? null,
      ip: data.ip ?? null,
      userAgent: data.userAgent ?? null,
      country: data.country ?? null,
      source: data.source ?? 'system',
    };
    return storage.run(full, fn);
  },
  current(): RequestContextData | undefined {
    return storage.getStore();
  },
  get correlationId(): string {
    return storage.getStore()?.correlationId ?? 'no-correlation';
  },
  get actor(): Actor | null {
    return storage.getStore()?.actor ?? null;
  },
  setActor(actor: Actor): void {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },
  metadata(): {
    ip: string | null;
    userAgent: string | null;
    country: string | null;
    correlationId: string;
  } {
    const s = storage.getStore();
    return {
      ip: s?.ip ?? null,
      userAgent: s?.userAgent ?? null,
      country: s?.country ?? null,
      correlationId: s?.correlationId ?? 'no-correlation',
    };
  },
};
