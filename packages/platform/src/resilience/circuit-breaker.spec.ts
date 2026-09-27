import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError, withRetry } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('s’ouvre après N échecs puis se referme après refroidissement et succès', async () => {
    let t = 0;
    const cb = new CircuitBreaker('psp', { failureThreshold: 2, cooldownMs: 1000, now: () => t });
    const fail = () => Promise.reject(new Error('KO'));
    await expect(cb.exec(fail)).rejects.toThrow('KO');
    await expect(cb.exec(fail)).rejects.toThrow('KO');
    await expect(cb.exec(() => Promise.resolve(1))).rejects.toBeInstanceOf(CircuitOpenError);
    t = 1001;
    expect(cb.currentState).toBe('HALF_OPEN');
    await expect(cb.exec(() => Promise.resolve(1))).resolves.toBe(1);
    expect(cb.currentState).toBe('CLOSED');
  });
});

describe('withRetry', () => {
  it('rejoue 3 fois avec les délais 1 s / 4 s puis abandonne', async () => {
    const slept: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('KO');
        },
        { sleep: async (ms) => void slept.push(ms) },
      ),
    ).rejects.toThrow('KO');
    expect(calls).toBe(3);
    expect(slept).toEqual([1000, 4000]);
  });

  it('réussit dès qu’un essai passe ; n’insiste pas sur une erreur non rejouable', async () => {
    let n = 0;
    await expect(
      withRetry(async () => (++n < 2 ? Promise.reject(new Error('x')) : 'ok'), {
        sleep: async () => undefined,
      }),
    ).resolves.toBe('ok');
    let m = 0;
    await expect(
      withRetry(
        async () => {
          m++;
          throw new Error('fatal');
        },
        { retryable: () => false, sleep: async () => undefined },
      ),
    ).rejects.toThrow('fatal');
    expect(m).toBe(1);
  });
});
