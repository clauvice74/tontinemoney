import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { testConfig } from '@tontine/config';
import { truncateAll, isCheckViolation } from '@tontine/database';
import { type EventEnvelope } from '@tontine/events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from './context/clock';
import { PrismaService } from './context/prisma.service';
import { RequestContext } from './context/request-context';
import { UnitOfWork } from './context/unit-of-work';
import { DomainError } from './errors/domain-error';
import { OnEvent } from './events/on-event.decorator';
import { OutboxRelay, OUTBOX_MAX_ATTEMPTS } from './events/outbox-relay';
import { OutboxService } from './events/outbox.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { PlatformModule } from './platform.module';

const received: Array<{ consumer: string; eventId: string }> = [];
let failNext = 0;

@Injectable()
class TestConsumers {
  @OnEvent('user.activated', { consumer: 'test-a' })
  async a(e: EventEnvelope): Promise<void> {
    received.push({ consumer: 'test-a', eventId: e.eventId });
  }

  @OnEvent('user.activated', { consumer: 'test-b' })
  async b(e: EventEnvelope): Promise<void> {
    if (failNext > 0) {
      failNext--;
      throw new Error('échec simulé');
    }
    received.push({ consumer: 'test-b', eventId: e.eventId });
  }
}

describe('Platform (intégration Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let relay: OutboxRelay;
  let uow: UnitOfWork;
  let idem: IdempotencyService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PlatformModule.forRoot({
          config: testConfig(),
          clock: new FixedClock('2026-09-24T10:00:00Z'),
        }),
      ],
      providers: [TestConsumers],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    outbox = moduleRef.get(OutboxService);
    relay = moduleRef.get(OutboxRelay);
    uow = moduleRef.get(UnitOfWork);
    idem = moduleRef.get(IdempotencyService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    received.length = 0;
    failNext = 0;
  });

  const emit = (userId = randomUUID()) =>
    uow.run((tx) =>
      outbox.add(tx, {
        type: 'user.activated',
        aggregateType: 'user',
        aggregateId: userId,
        payload: { userId },
      }),
    );

  it('publie l’événement écrit dans la transaction et propage la corrélation', async () => {
    const env = await RequestContext.run({ correlationId: 'corr-outbox-1' }, () => emit());
    expect(env.correlationId).toBe('corr-outbox-1');
    expect(await relay.drain()).toBe(1);
    expect(received.map((r) => r.consumer).sort()).toEqual(['test-a', 'test-b']);
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: env.eventId } });
    expect(row.status).toBe('PUBLISHED');
  });

  it('n’écrit rien si la transaction métier échoue (outbox transactionnel)', async () => {
    await expect(
      uow.run(async (tx) => {
        await outbox.add(tx, {
          type: 'user.activated',
          aggregateType: 'user',
          aggregateId: randomUUID(),
          payload: { userId: randomUUID() },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('consommateurs idempotents : un rejeu ne retraite pas un consommateur déjà passé', async () => {
    failNext = 1;
    const env = await emit();
    await relay.drain();
    expect(received).toEqual([{ consumer: 'test-a', eventId: env.eventId }]);
    let row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: env.eventId } });
    expect(row.status).toBe('PENDING');
    expect(row.lastError).toContain('échec simulé');
    // Rejeu immédiat (on force l’échéance)
    await prisma.outboxEvent.update({
      where: { id: env.eventId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await relay.drain();
    expect(received.filter((r) => r.consumer === 'test-a')).toHaveLength(1);
    expect(received.filter((r) => r.consumer === 'test-b')).toHaveLength(1);
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: env.eventId } });
    expect(row.status).toBe('PUBLISHED');
  });

  it('place l’événement en DLQ après le nombre maximal de tentatives', async () => {
    failNext = 1000;
    const env = await emit();
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await prisma.outboxEvent.update({
        where: { id: env.eventId },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await relay.drain(1);
    }
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: env.eventId } });
    expect(row.status).toBe('DEAD');
    await relay.requeue(env.eventId);
    failNext = 0;
    await relay.drain();
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: env.eventId } })).status,
    ).toBe('PUBLISHED');
  });

  it('idempotence HTTP : rejeu, requête différente, clé en cours', async () => {
    const userId = randomUUID();
    let calls = 0;
    const run = (body: unknown) =>
      idem.execute({ scope: 'test', key: 'key-12345678', userId, request: body }, async () => {
        calls++;
        return { status: 201, body: { ok: true, n: calls } };
      });
    const first = await run({ amount: '100' });
    const second = await run({ amount: '100' });
    expect(first).toEqual({ status: 201, body: { ok: true, n: 1 }, replayed: false });
    expect(second).toEqual({ status: 201, body: { ok: true, n: 1 }, replayed: true });
    expect(calls).toBe(1);
    await expect(run({ amount: '200' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    // Clé en cours de traitement
    let release!: () => void;
    const pending = idem.execute(
      { scope: 'test', key: 'key-inflight', userId, request: {} },
      () =>
        new Promise<{ status: number; body: unknown }>((r) => {
          release = () => r({ status: 200, body: {} });
        }),
    );
    await new Promise((r) => setTimeout(r, 50));
    await expect(
      idem.execute({ scope: 'test', key: 'key-inflight', userId, request: {} }, async () => ({
        status: 200,
        body: {},
      })),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    release();
    await pending;
  });

  it('idempotence : une erreur métier est mémorisée, une erreur technique libère la clé', async () => {
    const userId = randomUUID();
    await expect(
      idem.execute({ scope: 't', key: 'biz-error-1', userId, request: {} }, async () => {
        throw new DomainError('INSUFFICIENT_FUNDS');
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    const replay = await idem.execute(
      { scope: 't', key: 'biz-error-1', userId, request: {} },
      async () => ({ status: 200, body: 'jamais' }),
    );
    expect(replay.replayed).toBe(true);
    expect((replay.body as unknown as { code: string }).code).toBe('INSUFFICIENT_FUNDS');

    await expect(
      idem.execute({ scope: 't', key: 'tech-error-1', userId, request: {} }, async () => {
        throw new Error('panne');
      }),
    ).rejects.toThrow('panne');
    const retry = await idem.execute(
      { scope: 't', key: 'tech-error-1', userId, request: {} },
      async () => ({ status: 200, body: 'ok' }),
    );
    expect(retry).toEqual({ status: 200, body: 'ok', replayed: false });
  });

  it('les tables d’audit sont en ajout seul (trigger)', async () => {
    const row = await prisma.auditLog.create({
      data: { action: 'x', resourceType: 'y', result: 'SUCCESS' },
    });
    const err = await prisma.auditLog
      .update({ where: { id: row.id }, data: { action: 'z' } })
      .catch((e: unknown) => e);
    expect(isCheckViolation(err)).toBe(true);
    const del = await prisma.auditLog.delete({ where: { id: row.id } }).catch((e: unknown) => e);
    expect(isCheckViolation(del)).toBe(true);
  });
});
