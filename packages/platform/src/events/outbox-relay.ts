import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { type EventEnvelope } from '@tontine/events';
import { PrismaService } from '../context/prisma.service';
import { APP_CONFIG } from '../context/tokens';
import { MetricsService } from '../observability/metrics.service';
import { EventDispatcher } from './event-dispatcher';
import { type EventTransport, InProcessTransport, KafkaTransport } from './event-transport';

interface ClaimedRow {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  producer: string;
  correlationId: string;
  causationId: string | null;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
}

export const OUTBOX_MAX_ATTEMPTS = 8;
const LEASE_SECONDS = 60;
const BATCH_SIZE = 50;

/**
 * Relais de l'outbox : réclame un lot d'événements dus (bail + SKIP LOCKED, sûr en multi-instance),
 * les publie, puis les marque PUBLISHED ou planifie un rejeu (backoff exponentiel) ; au-delà de
 * OUTBOX_MAX_ATTEMPTS, l'événement passe en DEAD (DLQ).
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private transport: EventTransport;

  constructor(
    private readonly prisma: PrismaService,
    dispatcher: EventDispatcher,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.transport =
      config.EVENT_TRANSPORT === 'kafka'
        ? new KafkaTransport(config.KAFKA_BROKERS.split(','), dispatcher)
        : new InProcessTransport(dispatcher);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.NODE_ENV === 'test') return; // les tests appellent drain() explicitement
    await this.transport.start();
    this.timer = setInterval(() => void this.tick(), this.config.OUTBOX_POLL_INTERVAL_MS);
    this.logger.log(`Relais outbox démarré (transport : ${this.transport.name})`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.transport.stop();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processBatch();
      await this.refreshGauges();
    } catch (e) {
      this.logger.error(`Relais outbox : ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  /** Traite tous les événements dus jusqu'à épuisement (utilisé par les tests et les jobs). */
  async drain(maxRounds = 50): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const n = await this.processBatch();
      total += n;
      if (n === 0) break;
    }
    return total;
  }

  async processBatch(): Promise<number> {
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "outbox_events" SET "nextAttemptAt" = now() + make_interval(secs => ${LEASE_SECONDS}),
             "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "outbox_events"
        WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
        ORDER BY "seq" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "eventType", "eventVersion", "aggregateType", "aggregateId", "producer",
                "correlationId", "causationId", "payload", "occurredAt", "attempts"`;
    rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (const row of rows) {
      const envelope = {
        eventId: row.id,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        producer: row.producer,
        correlationId: row.correlationId,
        causationId: row.causationId,
        occurredAt: row.occurredAt.toISOString(),
        payload: row.payload,
      } as EventEnvelope;
      try {
        await this.transport.publish(envelope);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null },
        });
      } catch (e) {
        const dead = row.attempts >= OUTBOX_MAX_ATTEMPTS;
        const backoffSeconds = Math.min(3600, 2 ** row.attempts);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: dead ? 'DEAD' : 'PENDING',
            lastError: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
            nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000),
          },
        });
        if (dead) this.logger.error(`Événement ${row.eventType} ${row.id} placé en DLQ après ${row.attempts} tentatives`);
      }
    }
    return rows.length;
  }

  /** Remet un événement DEAD en file (action super-admin). */
  async requeue(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
  }

  private async refreshGauges(): Promise<void> {
    if (!this.metrics.enabled) return;
    const [pending, dead] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
    ]);
    this.metrics.outboxPending.set(pending);
    this.metrics.outboxDead.set(dead);
  }
}
