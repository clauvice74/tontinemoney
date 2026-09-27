import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixedClock } from './context/clock';
import { RequestContext } from './context/request-context';
import { DomainError } from './errors/domain-error';
import { ZodValidationPipe } from './http/zod';
import { MemoryKvStore } from './kv/kv-store';
import { RateLimiter } from './kv/rate-limiter';
import { requestFingerprint } from './idempotency/idempotency.service';

describe('MemoryKvStore', () => {
  it('respecte le TTL avec l’horloge injectée', async () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    const kv = new MemoryKvStore(clock);
    await kv.set('a', '1', 10);
    expect(await kv.get('a')).toBe('1');
    clock.advance(11_000);
    expect(await kv.get('a')).toBeNull();
  });

  it('incr crée la clé avec TTL puis incrémente', async () => {
    const kv = new MemoryKvStore(new FixedClock());
    expect(await kv.incr('c', 60)).toBe(1);
    expect(await kv.incr('c', 60)).toBe(2);
    expect(await kv.ttl('c')).toBe(60);
  });
});

describe('RateLimiter', () => {
  it('bloque au-delà de la limite puis se réinitialise à la fenêtre suivante', async () => {
    const clock = new FixedClock();
    const limiter = new RateLimiter(new MemoryKvStore(clock));
    const rule = { name: 'test', limit: 2, windowSeconds: 60 };
    await limiter.consume(rule, 'ip1');
    await limiter.consume(rule, 'ip1');
    await expect(limiter.consume(rule, 'ip1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await limiter.consume(rule, 'ip2');
    clock.advance(61_000);
    await expect(limiter.consume(rule, 'ip1')).resolves.toBeUndefined();
  });
});

describe('ZodValidationPipe', () => {
  it('lève VALIDATION_FAILED avec le détail des champs', () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string().min(1, 'Champ requis') }));
    try {
      pipe.transform({ name: '' });
      expect.fail('devait lever');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('VALIDATION_FAILED');
      expect((e as DomainError).fieldErrors).toEqual([{ path: 'name', message: 'Champ requis' }]);
    }
  });

  it('mappe les codes métier spécifiques', () => {
    const pipe = new ZodValidationPipe(
      z.object({ a: z.string().refine(() => false, 'Au moins un identifiant requis') }),
    );
    expect(() => pipe.transform({ a: 'x' })).toThrow(
      expect.objectContaining({ code: 'MISSING_IDENTIFIER' }),
    );
  });
});

describe('RequestContext', () => {
  it('propage la corrélation dans les appels asynchrones', async () => {
    await RequestContext.run({ correlationId: 'corr-123' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(RequestContext.correlationId).toBe('corr-123');
    });
    expect(RequestContext.current()).toBeUndefined();
  });
});

describe('Empreinte de requête', () => {
  it('est indépendante de l’ordre des clés', () => {
    expect(requestFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(
      requestFingerprint({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(requestFingerprint({ a: 1 })).not.toBe(requestFingerprint({ a: 2 }));
  });
});
