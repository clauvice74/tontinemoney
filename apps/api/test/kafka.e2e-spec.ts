import { randomUUID } from 'node:crypto';
import { DEAD_LETTER_TOPIC, buildEnvelope, topicFor } from '@tontine/events';
import { DeadLetterStore, EventDispatcher, KafkaTransport } from '@tontine/platform';
import { Kafka, logLevel } from 'kafkajs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestContext, createTestContext } from './support/test-app';

/**
 * Transport Kafka réel (étape 3) : exécuté seulement si un broker est fourni
 * (`KAFKA_TEST_BROKERS=localhost:19092`, Redpanda en Docker ou en CI).
 */
const brokers = process.env['KAFKA_TEST_BROKERS'];

describe.skipIf(!brokers)('Transport Kafka / Redpanda', () => {
  let ctx: TestContext;
  let transport: KafkaTransport;
  const kafka = new Kafka({
    clientId: 'tontinemoney-test',
    brokers: (brokers ?? '').split(','),
    logLevel: logLevel.NOTHING,
  });
  const handled: string[] = [];

  beforeAll(async () => {
    ctx = await createTestContext();
    await ctx.reset();
    const dispatcher = ctx.app.get(EventDispatcher);
    dispatcher.register('user.activated', 'test.kafka', async (e) => {
      handled.push(e.eventId);
    });
    transport = new KafkaTransport(
      {
        brokers: (brokers ?? '').split(','),
        clientId: 'tontinemoney-test',
        groupId: `tontinemoney-test-${randomUUID()}`,
        partitions: 1,
        maxAttempts: 2,
      },
      dispatcher,
      ctx.app.get(DeadLetterStore),
    );
    await transport.start();
  }, 60_000);

  afterAll(async () => {
    await transport?.stop();
    await ctx?.app.close();
  });

  async function until(check: () => Promise<boolean>, timeoutMs = 30_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Délai dépassé');
  }

  it('publication sur le topic versionné puis consommation idempotente', async () => {
    const userId = randomUUID();
    const e = buildEnvelope(
      { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId } },
      { correlationId: 'corr-kafka' },
    );
    const admin = kafka.admin();
    await admin.connect();
    expect(await admin.listTopics()).toEqual(
      expect.arrayContaining([topicFor('user.activated', 1), DEAD_LETTER_TOPIC]),
    );
    await admin.disconnect();
    await transport.publish(e);
    await transport.publish(e); // double publication
    await until(async () => handled.includes(e.eventId));
    await new Promise((r) => setTimeout(r, 1500));
    expect(handled.filter((id) => id === e.eventId)).toHaveLength(1);
    expect(
      await ctx.prisma.processedEvent.count({
        where: { consumer: 'test.kafka', eventId: e.eventId },
      }),
    ).toBe(1);
  }, 60_000);

  it('message invalide : consigné, publié sur le topic de rejet, la partition continue', async () => {
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: topicFor('user.activated', 1),
      messages: [{ key: 'poison', value: '{"eventType":"user.activated","eventVersion":1}' }],
    });
    const userId = randomUUID();
    const after = buildEnvelope(
      { type: 'user.activated', aggregateType: 'user', aggregateId: userId, payload: { userId } },
      { correlationId: 'corr-kafka' },
    );
    await transport.publish(after);
    await producer.disconnect();
    await until(
      async () => (await ctx.prisma.eventDeadLetter.count({ where: { source: 'kafka' } })) > 0,
    );
    await until(async () => handled.includes(after.eventId));
    const row = await ctx.prisma.eventDeadLetter.findFirstOrThrow({ where: { source: 'kafka' } });
    expect(row).toMatchObject({ stage: 'VALIDATION', topic: 'user.activated.v1' });

    const consumer = kafka.consumer({ groupId: `dlq-reader-${randomUUID()}` });
    await consumer.connect();
    await consumer.subscribe({ topics: [DEAD_LETTER_TOPIC], fromBeginning: true });
    const seen: Array<Record<string, string>> = [];
    await consumer.run({
      eachMessage: async ({ message }) => {
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(message.headers ?? {})) if (v) h[k] = v.toString();
        seen.push(h);
      },
    });
    await until(async () => seen.some((h) => h['x-dlq-stage'] === 'VALIDATION'));
    await consumer.disconnect();
  }, 90_000);
});
