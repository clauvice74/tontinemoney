import Redis from 'ioredis';
import { type Clock } from '../context/clock';

/** Stockage clé-valeur à TTL (blacklist JWT, rate limiting, cache de règles). */
export abstract class KvStore {
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  /** Incrémente et positionne le TTL à la création ; renvoie la nouvelle valeur. */
  abstract incr(key: string, ttlSeconds: number): Promise<number>;
  abstract ttl(key: string): Promise<number>;
  abstract close(): Promise<void>;
  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }
}

export class MemoryKvStore extends KvStore {
  private readonly data = new Map<string, { value: string; expiresAt: number | null }>();

  constructor(private readonly clock: Clock) {
    super();
  }

  private live(key: string) {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.clock.now().getTime()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds ? this.clock.now().getTime() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) {
      await this.set(key, '1', ttlSeconds);
      return 1;
    }
    const next = Number(entry.value) + 1;
    entry.value = String(next);
    return next;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - this.clock.now().getTime()) / 1000);
  }

  async close(): Promise<void> {
    this.data.clear();
  }

  clear(): void {
    this.data.clear();
  }
}

export class RedisKvStore extends KvStore {
  private readonly client: Redis;

  constructor(url: string) {
    super();
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: true });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.client.set(key, value, 'EX', Math.max(1, Math.ceil(ttlSeconds)));
    else await this.client.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const res = await this.client.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
    const first = res?.[0]?.[1];
    return typeof first === 'number' ? first : Number(first);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
