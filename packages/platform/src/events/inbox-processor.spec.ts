import { buildEnvelope, topicFor } from '@tontine/events';
import { describe, expect, it } from 'vitest';
import { EventDispatchError, type EventDispatcher } from './event-dispatcher';
import { kafkaHeaders, subscribedTopics } from './event-transport';
import { type DeadLetterEntry, InboxProcessor } from './inbox-processor';

const userId = '5b0c6a47-0b1c-4a07-9f63-1f6d2f5d8b11';
const envelope = () =>
  buildEnvelope(
    { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId } },
    { correlationId: 'corr-1', causationId: 'cause-1' },
  );

/** Dispatcher simulé : échoue `failures` fois, puis réussit ; idempotent par eventId. */
function dispatcher(failures = 0, consumer = 'members.activation') {
  const seen = new Set<string>();
  let calls = 0;
  const d = {
    handled: 0,
    get calls() {
      return calls;
    },
    async dispatch(e: { eventId: string }) {
      calls++;
      if (calls <= failures)
        throw new EventDispatchError([{ consumer, error: new Error('base indisponible') }]);
      if (!seen.has(e.eventId)) {
        seen.add(e.eventId);
        d.handled++;
      }
    },
  };
  return d;
}

function processor(d: ReturnType<typeof dispatcher>, maxAttempts = 3) {
  const dead: DeadLetterEntry[] = [];
  const waits: number[] = [];
  const p = new InboxProcessor(
    d as unknown as EventDispatcher,
    { record: async (e) => void dead.push(e) },
    { maxAttempts, backoffMs: [10, 50], sleep: async (ms) => void waits.push(ms) },
  );
  return { p, dead, waits };
}

const kafka = (value: unknown, topic = topicFor('user.activated', 1), offset = '42') => ({
  source: 'kafka' as const,
  topic,
  partition: 0,
  offset,
  value: typeof value === 'string' ? value : JSON.stringify(value),
});

describe('InboxProcessor — validation (rejet immédiat, jamais de réessai)', () => {
  it('message vide, JSON illisible, type inconnu, version non supportée, payload invalide', async () => {
    const d = dispatcher();
    const { p, dead } = processor(d);
    const cases: Array<[unknown, RegExp]> = [
      ['', /vide/],
      ['{pas du json', /JSON/],
      [{ ...envelope(), eventType: 'inconnu.evenement' }, /inconnu/],
      [{ ...envelope(), eventVersion: 2 }, /Version non supportée/],
      [{ ...envelope(), payload: { userId: 'x' } }, /Payload invalide/],
    ];
    for (const [value, reason] of cases) {
      expect(await p.handle(kafka(value))).toBe('dead-letter:validation');
      expect(dead.at(-1)).toMatchObject({
        stage: 'VALIDATION',
        attempts: 1,
        topic: 'user.activated.v1',
      });
      expect(dead.at(-1)?.reason).toMatch(reason);
    }
    expect(d.calls).toBe(0);
  });

  it('topic incohérent avec le type ou la version de l’enveloppe', async () => {
    const { p, dead } = processor(dispatcher());
    expect(await p.handle(kafka(envelope(), 'user.activated.v2'))).toBe('dead-letter:validation');
    expect(dead[0]?.reason).toMatch(/incohérent/);
  });

  it('le message d’origine est conservé pour le rejeu (tronqué à 256 Ko)', async () => {
    const { p, dead } = processor(dispatcher());
    await p.handle(kafka('x'.repeat(300 * 1024)));
    expect(dead[0]?.rawMessage.length).toBe(256 * 1024);
  });
});

describe('InboxProcessor — traitement', () => {
  it('nominal : traité une fois', async () => {
    const d = dispatcher();
    const { p, dead } = processor(d);
    expect(await p.handle(kafka(envelope()))).toBe('processed');
    expect(d.handled).toBe(1);
    expect(dead).toHaveLength(0);
  });

  it('événement dupliqué (redélivrance Kafka) : effet unique', async () => {
    const d = dispatcher();
    const { p } = processor(d);
    const e = envelope();
    await p.handle(kafka(e, undefined, '1'));
    await p.handle(kafka(e, undefined, '2'));
    expect(d.handled).toBe(1);
  });

  it('échec transitoire : réessais avec attente exponentielle puis succès', async () => {
    const d = dispatcher(2);
    const { p, dead, waits } = processor(d, 3);
    expect(await p.handle(kafka(envelope()))).toBe('processed');
    expect(d.calls).toBe(3);
    expect(waits).toEqual([10, 50]);
    expect(dead).toHaveLength(0);
  });

  it('échec persistant : rejet avec consommateurs en échec, enveloppe et tentatives', async () => {
    const d = dispatcher(99, 'wallets.create');
    const { p, dead } = processor(d, 3);
    const e = envelope();
    expect(await p.handle(kafka(e))).toBe('dead-letter:processing');
    expect(d.calls).toBe(3);
    expect(dead[0]).toMatchObject({
      stage: 'PROCESSING',
      consumers: ['wallets.create'],
      eventId: e.eventId,
      eventType: 'user.activated',
      eventVersion: 1,
      attempts: 3,
      offset: '42',
    });
  });

  it('panne du journal des rejets : l’erreur remonte (message non acquitté, jamais perdu)', async () => {
    const p = new InboxProcessor(
      dispatcher() as unknown as EventDispatcher,
      {
        record: async () => {
          throw new Error('journal indisponible');
        },
      },
      { maxAttempts: 1 },
    );
    await expect(p.handle(kafka('{'))).rejects.toThrow('journal indisponible');
  });
});

describe('Transport Kafka — nommage et en-têtes', () => {
  it('topics versionnés pour les seuls types connus', () => {
    expect(subscribedTopics(['user.activated', 'payment.completed', 'inconnu'])).toEqual([
      'user.activated.v1',
      'payment.completed.v1',
    ]);
  });

  it('en-têtes de corrélation et de causalité', () => {
    const e = envelope();
    expect(kafkaHeaders(e)).toEqual({
      eventId: e.eventId,
      eventType: 'user.activated',
      eventVersion: '1',
      producer: 'auth',
      correlationId: 'corr-1',
      causationId: 'cause-1',
    });
  });
});
