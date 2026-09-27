export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Disjoncteur par service amont : après `failures` échecs consécutifs (connexion, délai,
 * 502/503/504), le circuit s'ouvre et le gateway répond 503 sans appeler le service pendant
 * `resetMs` ; une seule requête d'essai est ensuite autorisée (semi-ouvert).
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutive = 0;
  private openedAt = 0;
  private probing = false;

  constructor(
    private readonly failures: number,
    private readonly resetMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get current(): CircuitState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.resetMs) return 'HALF_OPEN';
    return this.state;
  }

  /** false : court-circuiter la requête. */
  tryAcquire(): boolean {
    const s = this.current;
    if (s === 'CLOSED') return true;
    if (s === 'OPEN' || this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.state = 'CLOSED';
    this.consecutive = 0;
    this.probing = false;
  }

  failure(): void {
    this.probing = false;
    this.consecutive++;
    if (this.state !== 'CLOSED' || this.consecutive >= this.failures) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
