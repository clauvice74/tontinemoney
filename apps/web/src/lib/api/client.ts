import { ApiError, NetworkError, type ProblemBody } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  /** Corps JSON (objet) ou multipart (`FormData`). */
  body?: unknown;
  query?: Record<string, QueryValue | QueryValue[]>;
  headers?: Record<string, string>;
  /** En-tête `Idempotency-Key` (POST financiers). */
  idempotencyKey?: string;
  /** `false` : pas d'en-tête Authorization ni de rafraîchissement automatique. */
  auth?: boolean;
  signal?: AbortSignal;
  /** Type de réponse attendu (défaut : JSON, ou `undefined` pour 204). */
  responseType?: 'json' | 'blob' | 'text';
}

export interface ApiClientOptions {
  /** Origine de l'API (vide = même origine, via les rewrites Next.js). */
  baseUrl?: string;
  /** Préfixe versionné des routes. */
  prefix?: string;
  fetch?: typeof fetch;
  getAccessToken: () => string | null;
  setAccessToken: (token: string | null) => void;
  /** Appelé quand la session ne peut pas être rafraîchie (déconnexion forcée). */
  onSessionExpired?: () => void;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T>;
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  /**
   * Rafraîchit le jeton d'accès via le cookie HttpOnly `tm_rt`.
   * Un seul appel réseau à la fois : les appels concurrents partagent la même promesse
   * (indispensable avec la rotation des refresh tokens et la détection de réutilisation).
   */
  refresh(): Promise<string | null>;
  /** URL absolue (même origine) d'une route, pour les liens de téléchargement / images. */
  url(path: string, query?: RequestOptions['query']): string;
}

/** Codes 401 déclenchant un rafraîchissement puis un unique rejeu. */
const REFRESHABLE_CODES = new Set(['INVALID_TOKEN', 'UNAUTHENTICATED']);

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (v === undefined || v === null || v === '') continue;
      params.append(key, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function parseProblem(res: Response): Promise<ProblemBody> {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object') return body as ProblemBody;
    } catch {
      // corps illisible : on retombe sur le statut
    }
  }
  return { status: res.status };
}

function retryAfterOf(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const n = Number(h);
  return Number.isFinite(n) ? n : undefined;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const prefix = options.prefix ?? '/api/v1';
  const doFetch: typeof fetch = (...args) => (options.fetch ?? globalThis.fetch)(...args);
  let inflightRefresh: Promise<string | null> | null = null;

  const url = (path: string, query?: RequestOptions['query']) =>
    `${baseUrl}${prefix}${path.startsWith('/') ? path : `/${path}`}${buildQuery(query)}`;

  async function send(path: string, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.body instanceof FormData) {
      body = opts.body;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.auth !== false) {
      const token = options.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    try {
      return await doFetch(url(path, opts.query), {
        method: opts.method ?? 'GET',
        headers,
        body,
        credentials: 'same-origin',
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new NetworkError(e);
    }
  }

  async function refresh(): Promise<string | null> {
    if (inflightRefresh) return inflightRefresh;
    inflightRefresh = (async () => {
      try {
        const res = await doFetch(url('/auth/refresh'), {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: '{}',
          credentials: 'include',
        });
        if (!res.ok) {
          options.setAccessToken(null);
          return null;
        }
        const data = (await res.json()) as { accessToken?: string };
        const token = data.accessToken ?? null;
        options.setAccessToken(token);
        return token;
      } catch (e) {
        throw new NetworkError(e);
      }
    })();
    try {
      return await inflightRefresh;
    } finally {
      inflightRefresh = null;
    }
  }

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    let res = await send(path, opts);

    if (res.status === 401 && opts.auth !== false && !path.startsWith('/auth/refresh')) {
      const problem = await parseProblem(res.clone());
      if (problem.code && REFRESHABLE_CODES.has(problem.code)) {
        const token = await refresh();
        if (!token) {
          options.onSessionExpired?.();
          throw new ApiError(401, problem, retryAfterOf(res));
        }
        res = await send(path, opts);
      }
    }

    if (!res.ok) {
      const problem = await parseProblem(res);
      if (res.status === 401 && problem.code && REFRESHABLE_CODES.has(problem.code)) {
        options.onSessionExpired?.();
      }
      throw new ApiError(res.status, problem, retryAfterOf(res));
    }

    if (opts.responseType === 'blob') return (await res.blob()) as T;
    if (opts.responseType === 'text') return (await res.text()) as T;
    if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return (await res.text()) as T;
    return (await res.json()) as T;
  }

  return {
    request,
    get: (path, o) => request(path, { ...o, method: 'GET' }),
    post: (path, body, o) => request(path, { ...o, method: 'POST', body }),
    put: (path, body, o) => request(path, { ...o, method: 'PUT', body }),
    patch: (path, body, o) => request(path, { ...o, method: 'PATCH', body }),
    delete: (path, o) => request(path, { ...o, method: 'DELETE' }),
    refresh,
    url,
  };
}
