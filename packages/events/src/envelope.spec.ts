import { describe, expect, it } from 'vitest';
import {
  DEAD_LETTER_TOPIC,
  EventValidationError,
  buildEnvelope,
  parseEnvelope,
  topicFor,
} from './envelope';
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
        {
          type: 'user.activated',
          aggregateType: 'user',
          aggregateId: userId,
          payload: { userId: 'x' },
        },
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

describe('Étape 3 — enveloppe et topics', () => {
  const base = () =>
    buildEnvelope(
      { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId } },
      { correlationId: 'corr-1', causationId: 'cause-1' },
    );

  it('tenantId présent (null par défaut), causationId propagé', () => {
    expect(base()).toMatchObject({ tenantId: null, causationId: 'cause-1' });
  });

  it('topic versionné et topic de rejet', () => {
    expect(topicFor('payment.completed', 1)).toBe('payment.completed.v1');
    expect(DEAD_LETTER_TOPIC).toBe('tontinemoney.dead-letter.v1');
  });

  it('lecteur tolérant : message sans tenantId ni causationId accepté (valeurs null)', () => {
    const { tenantId: _t, causationId: _c, ...legacy } = base();
    expect(parseEnvelope(JSON.parse(JSON.stringify(legacy)))).toMatchObject({
      tenantId: null,
      causationId: null,
    });
  });

  it('rejette type inconnu, horodatage invalide, identifiant non textuel', () => {
    expect(() => parseEnvelope({ ...base(), eventType: 'inconnu.x' })).toThrow(
      EventValidationError,
    );
    expect(() => parseEnvelope({ ...base(), occurredAt: 'hier' })).toThrow(/Horodatage/);
    expect(() => parseEnvelope({ ...base(), tenantId: 42 })).toThrow(/tenantId/);
    expect(() => parseEnvelope({ ...base(), aggregateId: 7 })).toThrow(/aggregateId/);
  });
});
