import { Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { KvStore } from './kv-store';

export interface RateLimitRule {
  /** Espace de noms (ex. `login:ip`). */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Limiteur à fenêtre fixe (Redis INCR + EXPIRE). */
@Injectable()
export class RateLimiter {
  constructor(private readonly kv: KvStore) {}

  async hit(
    rule: RateLimitRule,
    subject: string,
  ): Promise<{ count: number; allowed: boolean; retryAfter: number }> {
    const key = `rl:${rule.name}:${subject}`;
    const count = await this.kv.incr(key, rule.windowSeconds);
    const allowed = count <= rule.limit;
    const retryAfter = allowed ? 0 : Math.max(1, await this.kv.ttl(key));
    return { count, allowed, retryAfter };
  }

  /** Lève RATE_LIMITED si la limite est dépassée. */
  async consume(rule: RateLimitRule, subject: string): Promise<void> {
    const res = await this.hit(rule, subject);
    if (!res.allowed) {
      throw new DomainError('RATE_LIMITED', 'Trop de requêtes, réessayez plus tard', {
        retryAfter: res.retryAfter,
      });
    }
  }

  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    await this.kv.del(`rl:${rule.name}:${subject}`);
  }
}
