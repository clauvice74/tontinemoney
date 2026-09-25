import { ERROR_CATALOG, type ErrorCode } from '@tontine/contracts';

export interface FieldIssue {
  path: string;
  message: string;
}

/** Corps d'erreur Problem Details (RFC 9457) tel que renvoyé par l'API. */
export interface ProblemBody {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  correlationId?: string;
  errors?: FieldIssue[];
  [extra: string]: unknown;
}

const STATUS_FALLBACK: Record<number, string> = {
  400: 'Données invalides',
  401: 'Authentification requise',
  403: 'Accès refusé',
  404: 'Ressource introuvable',
  409: 'Conflit',
  410: 'Lien ou code expiré',
  413: 'Fichier trop volumineux',
  415: 'Type de fichier non accepté',
  422: 'Opération impossible',
  423: 'Compte temporairement verrouillé',
  429: 'Trop de requêtes, réessayez dans quelques instants',
  500: 'Erreur interne du serveur',
  502: 'Service momentanément indisponible',
  503: 'Service momentanément indisponible',
  504: 'Le serveur met trop de temps à répondre',
};

function isKnownCode(code: string | undefined): code is ErrorCode {
  return !!code && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code);
}

/** Erreur HTTP de l'API, construite à partir d'un Problem Details. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: FieldIssue[];
  readonly correlationId: string | undefined;
  readonly retryAfter: number | undefined;
  readonly body: ProblemBody;

  constructor(status: number, body: ProblemBody, retryAfter?: number) {
    const code = body.code ?? `HTTP_${status}`;
    const title =
      body.title ??
      (isKnownCode(body.code) ? ERROR_CATALOG[body.code].title : undefined) ??
      STATUS_FALLBACK[status] ??
      'Une erreur est survenue';
    super(body.detail ?? title);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = body.detail;
    this.errors = Array.isArray(body.errors) ? body.errors : [];
    this.correlationId = body.correlationId;
    this.retryAfter = retryAfter;
    this.body = body;
  }

  /** Erreurs par champ (`errors[].path` → message), premier message conservé par champ. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.errors) {
      const key = normalizePath(e.path);
      if (key && !(key in out)) out[key] = e.message;
    }
    return out;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Échec réseau (API injoignable, coupure) : aucune réponse HTTP reçue. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Impossible de joindre le serveur. Vérifiez votre connexion puis réessayez.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** `frequencyDetail/day`, `frequencyDetail[0]`, `body.amount` → `frequencyDetail.day`, … */
export function normalizePath(path: string | undefined): string {
  if (!path) return '';
  return path
    .replace(/^\/+/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\//g, '.')
    .replace(/^body\./, '');
}

/** Message d'erreur lisible en français pour n'importe quelle erreur. */
export function errorMessage(error: unknown): { title: string; detail?: string | undefined } {
  if (error instanceof ApiError) {
    if (error.code === 'MFA_REQUIRED') {
      return {
        title: 'Double authentification requise',
        detail:
          'Cette section exige une session ouverte avec la double authentification (MFA). Activez-la dans « Sécurité » puis reconnectez-vous.',
      };
    }
    if (error.code === 'RATE_LIMITED' && error.retryAfter) {
      return {
        title: error.title,
        detail: `Réessayez dans ${error.retryAfter} seconde${error.retryAfter > 1 ? 's' : ''}.`,
      };
    }
    return {
      title: error.title,
      detail: error.detail && error.detail !== error.title ? error.detail : undefined,
    };
  }
  if (error instanceof NetworkError) {
    return { title: 'Connexion impossible', detail: error.message };
  }
  if (error instanceof Error && error.message) {
    return { title: 'Une erreur est survenue', detail: error.message };
  }
  return { title: 'Une erreur est survenue' };
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
