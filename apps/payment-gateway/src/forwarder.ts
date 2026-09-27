import { signInternalRequest } from '@tontine/auth';
import { type PaymentNotification } from '@tontine/contracts';

export const CALLER = 'payment-gateway';

export type ForwardResult =
  | { ok: true; outcome: string; attempts: number }
  /** `retryable: false` : refus définitif du Payment Service (4xx), inutile de réessayer. */
  | { ok: false; error: string; attempts: number; retryable: boolean };

/**
 * Transmission au Payment Service : appel interne signé (HMAC), délai borné, réessais avec
 * attente exponentielle sur erreur réseau ou 5xx. Le Payment Service est idempotent
 * (identifiant d'événement) : un réessai après un succès non acquitté est sans effet.
 */
export class Forwarder {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly timeoutMs: number,
    private readonly maxAttempts: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async forward(n: PaymentNotification, correlationId: string): Promise<ForwardResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/internal/payments/notifications`;
    const body = JSON.stringify(n);
    let lastError = 'unknown';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': correlationId,
            ...signInternalRequest(this.secret, CALLER, body),
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        if (res.ok) {
          const outcome = (JSON.parse(text) as { result?: unknown }).result;
          return {
            ok: true,
            outcome: typeof outcome === 'string' ? outcome : 'UNKNOWN',
            attempts: attempt,
          };
        }
        lastError = `HTTP ${res.status}`;
        // 4xx : réessayer immédiatement ne changerait rien. 401/403 (secret interne mal
        // configuré) reste « réessayable » plus tard par le PSP ; 400/404/422 sont définitifs.
        if (res.status < 500)
          return {
            ok: false,
            error: `${lastError} ${text.slice(0, 200)}`,
            attempts: attempt,
            retryable: res.status === 401 || res.status === 403,
          };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      if (attempt < this.maxAttempts) await this.sleep(100 * 2 ** (attempt - 1));
    }
    return { ok: false, error: lastError, attempts: this.maxAttempts, retryable: true };
  }
}
