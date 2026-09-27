import { type ServerResponse } from 'node:http';

/** Erreurs du gateway au format Problem Details (RFC 9457), comme les services. */
export const GATEWAY_ERRORS = {
  NOT_FOUND: { status: 404, title: 'Ressource introuvable' },
  UNAUTHENTICATED: { status: 401, title: 'Authentification requise' },
  FORBIDDEN: { status: 403, title: 'Accès refusé' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Requête trop volumineuse' },
  RATE_LIMITED: { status: 429, title: 'Trop de requêtes' },
  UPSTREAM_ERROR: { status: 502, title: 'Service indisponible' },
  UPSTREAM_UNAVAILABLE: { status: 503, title: 'Service temporairement indisponible' },
  UPSTREAM_TIMEOUT: { status: 504, title: 'Délai de réponse dépassé' },
} as const;
export type GatewayErrorCode = keyof typeof GATEWAY_ERRORS;

export function sendProblem(
  res: ServerResponse,
  code: GatewayErrorCode,
  correlationId: string,
  instance: string,
  extra: { detail?: string; headers?: Record<string, string> } = {},
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const { status, title } = GATEWAY_ERRORS[code];
  const body = JSON.stringify({
    type: `https://tontinemoney.local/errors/${code.toLowerCase().replace(/_/g, '-')}`,
    title,
    status,
    code,
    ...(extra.detail ? { detail: extra.detail } : {}),
    instance,
    correlationId,
  });
  res.writeHead(status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Correlation-Id': correlationId,
    'Cache-Control': 'no-store',
    ...extra.headers,
  });
  res.end(body);
}
