/**
 * Limiteur à fenêtre fixe d'une minute, en mémoire (une instance de gateway).
 * Plusieurs instances : partager le compteur (Redis) — voir docs/local-development.md.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** `allowed: false` et `retryAfterSeconds` quand la limite est atteinte. */
  hit(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 100_000) this.sweep(t);
    }
    w.count++;
    const retryAfterSeconds = Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000));
    return {
      allowed: w.count <= this.limit,
      remaining: Math.max(0, this.limit - w.count),
      retryAfterSeconds,
    };
  }

  private sweep(t: number): void {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
