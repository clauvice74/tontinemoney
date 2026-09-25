import { describe, expect, it } from 'vitest';
import { buildEnvelope, parseEnvelope, EventValidationError } from './envelope';
import { EVENT_CATALOG, EVENT_TYPES } from './catalog';

const userId = '5b0c6a47-0b1c-4a07-9f63-1f6d2f5d8b11';

describe('Enveloppe d’événement', () => {
  it('contient tous les champs obligatoires (§13)', () => {
    const env = buildEnvelope(
      { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId } },
      { correlationId: 'corr-1' },
    );
    expect(env).toMatchObject({
      eventType: 'user.activated',
      eventVersion: 1,
      correlationId: 'corr-1',
      causationId: null,
      producer: 'auth',
      payload: { userId },
    });
    expect(env.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => new Date(env.occurredAt).toISOString()).not.toThrow();
  });

  it('refuse un payload non conforme au catalogue', () => {
    expect(() =>
      buildEnvelope(
        { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId: 'x' } },
        { correlationId: 'c' },
      ),
    ).toThrow(EventValidationError);
  });

  it('refuse une version non supportée à la réception', () => {
    const env = buildEnvelope(
      { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId } },
      { correlationId: 'c' },
    );
    expect(parseEnvelope(env).eventId).toBe(env.eventId);
    expect(() => parseEnvelope({ ...env, eventVersion: 99 })).toThrow(/Version/);
    expect(() => parseEnvelope({ ...env, eventType: 'inconnu' })).toThrow(/inconnu/);
  });

  it('chaque événement du catalogue déclare producteur et version', () => {
    for (const t of EVENT_TYPES) {
      expect(EVENT_CATALOG[t].producer).toBeTruthy();
      expect(EVENT_CATALOG[t].version).toBeGreaterThanOrEqual(1);
    }
  });
});
