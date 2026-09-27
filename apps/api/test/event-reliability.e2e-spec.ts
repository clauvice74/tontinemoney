import { randomUUID } from 'node:crypto';
import { buildEnvelope, topicFor } from '@tontine/events';
import {
  DeadLetterStore,
  EventDispatcher,
  InboxProcessor,
  OutboxService,
  UnitOfWork,
} from '@tontine/platform';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, bearer, createTestContext } from './support/test-app';

/** Étape 3 (A-52) : fiabilité des consommateurs — rejet, redélivrance, rejeu, tenantId. */
let ctx: TestContext;
let processor: InboxProcessor;
let flakyFails = false;
let flakyCalls = 0;

beforeAll(async () => {
  ctx = await createTestContext();
  const dispatcher = ctx.app.get(EventDispatcher);
  // Consommateur de test : échoue tant que `flakyFails` est vrai
  dispatcher.register('user.activated', 'test.flaky', async () => {
    flakyCalls++;
    if (flakyFails) throw new Error('dépendance indisponible');
  });
  processor = new InboxProcessor(dispatcher, ctx.app.get(DeadLetterStore), {
    maxAttempts: 2,
    sleep: async () => undefined,
  });
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  flakyFails = false;
  flakyCalls = 0;
});

const TOPIC = topicFor('user.activated', 1);
let offset = 1000;
function message(value: unknown, off = String(offset++)) {
  return {
    source: 'kafka' as const,
    topic: TOPIC,
    partition: 0,
    offset: off,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    headers: { correlationId: 'corr-test' },
  };
}
const activated = (userId: string) =>
  buildEnvelope(
    { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId } },
    { correlationId: 'corr-test' },
  );

async function adminToken() {
  return ctx.token(await ctx.createUser({ role: 'SUPER_ADMIN' }));
}

describe('Message invalide', () => {
  it('consigné (VALIDATION), listé, rejeu refusé (toujours invalide), abandon', async () => {
    expect(await processor.handle(message('{"eventType":"inconnu"}'))).toBe(
      'dead-letter:validation',
    );
    const row = await ctx.prisma.eventDeadLetter.findFirstOrThrow();
    expect(row).toMatchObject({ stage: 'VALIDATION', status: 'OPEN', topic: TOPIC, attempts: 1 });
    const token = await adminToken();
    const list = await ctx.http.get('/api/v1/admin/events/dead-letters').set(bearer(token));
    expect(list.body.data.map((d: { id: string }) => d.id)).toEqual([row.id]);
    const replay = await ctx.http
      .post(`/api/v1/admin/events/dead-letters/${row.id}/replay`)
      .set(bearer(token));
    expect(replay.status).toBe(422);
    expect(
      (await ctx.prisma.eventDeadLetter.findUniqueOrThrow({ where: { id: row.id } })).attempts,
    ).toBe(2);
    await ctx.http
      .post(`/api/v1/admin/events/dead-letters/${row.id}/discard`)
      .set(bearer(token))
      .expect(200);
    await ctx.http
      .post(`/api/v1/admin/events/dead-letters/${row.id}/replay`)
      .set(bearer(token))
      .expect(422);
    const discarded = await ctx.http
      .get('/api/v1/admin/events/dead-letters?status=DISCARDED')
      .set(bearer(token));
    expect(discarded.body.data[0]).toMatchObject({ id: row.id, status: 'DISCARDED' });
  });

  it('redélivrance du même message (même topic, partition, offset) : une seule entrée', async () => {
    const m = message('pas du json', '77');
    await processor.handle(m);
    await processor.handle(m);
    expect(await ctx.prisma.eventDeadLetter.count()).toBe(1);
  });
});

describe('Consommateur en échec', () => {
  it('rejet après réessais ; les autres consommateurs ont traité une seule fois ; rejeu après correction', async () => {
    const m = await ctx.createUser({ status: 'ACTIVE' });
    const e = activated(m.id);
    flakyFails = true;
    expect(await processor.handle(message(e))).toBe('dead-letter:processing');
    expect(flakyCalls).toBe(2);
    const row = await ctx.prisma.eventDeadLetter.findFirstOrThrow();
    expect(row).toMatchObject({
      stage: 'PROCESSING',
      consumers: ['test.flaky'],
      eventId: e.eventId,
      eventType: 'user.activated',
      attempts: 2,
    });
    const others = await ctx.prisma.processedEvent.findMany({ where: { eventId: e.eventId } });
    expect(others.map((p) => p.consumer)).not.toContain('test.flaky');
    const doneBefore = others.length;

    const token = await adminToken();
    expect(
      (await ctx.http.post(`/api/v1/admin/events/dead-letters/${row.id}/replay`).set(bearer(token)))
        .status,
    ).toBe(422);
    flakyFails = false;
    const ok = await ctx.http
      .post(`/api/v1/admin/events/dead-letters/${row.id}/replay`)
      .set(bearer(token));
    expect(ok.body).toEqual({ id: row.id, status: 'REPLAYED' });
    const after = await ctx.prisma.processedEvent.findMany({ where: { eventId: e.eventId } });
    expect(after.map((p) => p.consumer)).toContain('test.flaky');
    expect(after).toHaveLength(doneBefore + 1);
  });

  it('réservé au super-admin', async () => {
    const member = await ctx.createUser();
    await ctx.http
      .get('/api/v1/admin/events/dead-letters')
      .set(bearer(await ctx.token(member)))
      .expect(403);
  });
});

describe('Enveloppe', () => {
  it('tenantId conservé par l’outbox et restitué au relais ; causationId propagé', async () => {
    const userId = randomUUID();
    await ctx.app.get(UnitOfWork).run((tx) =>
      ctx.app.get(OutboxService).add(tx, {
        type: 'user.activated',
        aggregateType: 'user',
        aggregateId: userId,
        payload: { userId },
        tenantId: 'operateur-cm',
        causationId: 'evt-origine',
      }),
    );
    const row = await ctx.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: userId } });
    expect(row).toMatchObject({ tenantId: 'operateur-cm', causationId: 'evt-origine' });
  });
});
