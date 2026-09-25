import { ERROR_CATALOG, type ErrorCode } from '@tontine/contracts';

/** Erreur métier normalisée ; convertie en Problem Details par le filtre global. */
export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    detail?: string,
    readonly extra: Record<string, unknown> = {},
    readonly fieldErrors?: Array<{ path: string; message: string }>,
  ) {
    super(detail ?? ERROR_CATALOG[code].title);
    this.name = 'DomainError';
    this.status = ERROR_CATALOG[code].status;
  }

  get title(): string {
    return ERROR_CATALOG[this.code].title;
  }
}

export function notFound(what = 'Ressource'): DomainError {
  return new DomainError('NOT_FOUND', `${what} introuvable`);
}

export function forbidden(detail = 'Accès refusé'): DomainError {
  return new DomainError('FORBIDDEN', detail);
}

export function invalidTransition(from: string, to: string, entity = 'ressource'): DomainError {
  return new DomainError('INVALID_STATE_TRANSITION', `Transition ${from} → ${to} interdite pour ${entity}`, {
    from,
    to,
  });
}
