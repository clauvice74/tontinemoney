/**
 * Disjoncteur (circuit breaker) et rejeu avec backoff exponentiel pour les appels
 * aux fournisseurs externes (PSP, KYC, SMS). États : CLOSED → OPEN (après N échecs) →
 * HALF_OPEN (après le délai de refroidissement) → CLOSED (succès) ou OPEN (échec).
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  constructor(readonly circuit: string) {
    super(`Circuit « ${circuit} » ouvert : fournisseur temporairement indisponible`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.threshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  get currentState(): CircuitState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.cooldownMs)
      this.state = 'HALF_OPEN';
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.currentState === 'OPEN') throw new CircuitOpenError(this.name);
    try {
      const res = await fn();
      this.failures = 0;
      this.state = 'CLOSED';
      return res;
    } catch (e) {
      this.failures++;
      if (this.state === 'HALF_OPEN' || this.failures >= this.threshold) {
        this.state = 'OPEN';
        this.openedAt = this.now();
      }
      throw e;
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
  }
}

export interface RetryOptions {
  attempts?: number;
  /** Délais successifs en ms (R-PAY-03 : 1 s, 4 s, 16 s). */
  delaysMs?: number[];
  retryable?: (e: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delays = options.delaysMs ?? [1000, 4000, 16000];
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i === attempts || (options.retryable && !options.retryable(e))) break;
      await sleep(delays[i - 1] ?? delays[delays.length - 1] ?? 0);
    }
  }
  throw last;
}
