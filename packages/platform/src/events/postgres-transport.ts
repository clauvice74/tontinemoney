import { Logger } from '@nestjs/common';
import { EVENT_CATALOG, type EventEnvelope, isEventType, topicFor } from '@tontine/events';
import { randomUUID } from 'node:crypto';
import { type PrismaService } from '../context/prisma.service';
import { type EventDispatcher } from './event-dispatcher';
import { type EventTransport } from './event-transport';
import { type DeadLetterSink, InboxProcessor } from './inbox-processor';

/** Verrou consultatif de publication : un seul relais attribue les positions à la fois. */
const PUBLISH_LOCK = 7_415_202_601;
const PUBLISH_BATCH = 200;
const CONSUME_BATCH = 100;
const LEASE_SECONDS = 30;

export interface PostgresTransportOptions {
  /** Groupe de consommateurs (un par service) : position propre dans le journal. */
  group: string;
  maxAttempts: number;
  pollIntervalMs: number;
}

interface LogRow {
  deliverySeq: bigint;
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  producer: string;
  tenantId: string | null;
  correlationId: string;
  causationId: string | null;
  payload: unknown;
  occurredAt: Date;
}

/**
 * Transport PostgreSQL (étape 7, A-55) : l'outbox partagée devient un journal ordonné.
 * - Publication (relais) : sous verrou consultatif, les événements dus reçoivent une position
 *   croissante `deliverySeq` dans l'ordre de leur validation, puis passent en PUBLISHED.
 * - Consommation : chaque service (groupe) lit le journal depuis sa position, traite via
 *   InboxProcessor (validation, réessais bornés, rejet sans blocage) et avance sa position ;
 *   un bail garantit une seule instance active par groupe. Aucun courtier : utilisable sans
 *   Docker ; Kafka reste le transport de production (même sémantique de groupes).
 */
export class PostgresTransport implements EventTransport {
  readonly name = 'postgres';
  private readonly logger = new Logger(PostgresTransport.name);
  private readonly processor: InboxProcessor;
  private readonly instance = `${process.pid}-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private consuming = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: EventDispatcher,
    deadLetters: DeadLetterSink,
    private readonly options: PostgresTransportOptions,
  ) {
    this.processor = new InboxProcessor(dispatcher, deadLetters, {
      maxAttempts: options.maxAttempts,
    });
  }

  async start(): Promise<void> {
    await this.ensureGroup();
    this.timer = setInterval(() => void this.tick(), this.options.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.prisma.eventSubscription.updateMany({
      where: { group: this.options.group, owner: this.instance },
      data: { owner: null, leaseUntil: null },
    });
  }

  /** Non utilisé : la publication se fait par lot (`publishPending`). */
  async publish(): Promise<void> {
    throw new Error('Transport PostgreSQL : publication par lot uniquement');
  }

  /**
   * Attribue les positions des événements dus (ordre de l'outbox) et les marque publiés.
   * Le verrou garantit que les positions sont validées dans l'ordre croissant.
   */
  async publishPending(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUBLISH_LOCK})`;
      return tx.$executeRaw`
        WITH base AS (
          SELECT coalesce(max("deliverySeq"), 0) AS m FROM "outbox_events"
        ), due AS (
          SELECT "id", row_number() OVER (ORDER BY "seq") AS rn FROM (
            SELECT "id", "seq" FROM "outbox_events"
            WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
            ORDER BY "seq" LIMIT ${PUBLISH_BATCH}
            FOR UPDATE SKIP LOCKED
          ) d
        )
        UPDATE "outbox_events" o
        SET "status" = 'PUBLISHED', "publishedAt" = now(), "deliverySeq" = base.m + due.rn,
            "lastError" = NULL
        FROM due, base WHERE o."id" = due."id"`;
    });
  }

  private async tick(): Promise<void> {
    if (this.consuming) return;
    this.consuming = true;
    try {
      while ((await this.consumeOnce()) > 0);
    } catch (e) {
      this.logger.error(`Groupe ${this.options.group} : ${e instanceof Error ? e.message : e}`);
    } finally {
      this.consuming = false;
    }
  }

  private async ensureGroup(): Promise<void> {
    await this.prisma.eventSubscription.createMany({
      data: [{ group: this.options.group }],
      skipDuplicates: true,
    });
  }

  /**
   * Traite le prochain lot du journal pour ce groupe. Retourne le nombre de messages lus
   * (0 : à jour, ou bail détenu par une autre instance).
   */
  async consumeOnce(): Promise<number> {
    await this.ensureGroup();
    const leased = await this.prisma.$queryRaw<Array<{ position: bigint }>>`
      UPDATE "event_subscriptions"
      SET "owner" = ${this.instance},
          "leaseUntil" = now() + make_interval(secs => ${LEASE_SECONDS}), "updatedAt" = now()
      WHERE "group" = ${this.options.group}
        AND ("owner" IS NULL OR "owner" = ${this.instance} OR "leaseUntil" < now())
      RETURNING "position"`;
    const start = leased[0]?.position;
    if (start === undefined) return 0;
    const rows = await this.prisma.$queryRaw<LogRow[]>`
      SELECT "deliverySeq", "id", "eventType", "eventVersion", "aggregateType", "aggregateId",
             "producer", "tenantId", "correlationId", "causationId", "payload", "occurredAt"
      FROM "outbox_events"
      WHERE "deliverySeq" > ${start}
      ORDER BY "deliverySeq" ASC
      LIMIT ${CONSUME_BATCH}`;
    const subscribed = new Set(this.dispatcher.subscribedTypes());
    for (const row of rows) {
      if (subscribed.has(row.eventType)) {
        const envelope: EventEnvelope = {
          eventId: row.id,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          producer: row.producer,
          tenantId: row.tenantId,
          correlationId: row.correlationId,
          causationId: row.causationId,
          occurredAt: row.occurredAt.toISOString(),
          payload: row.payload,
        } as EventEnvelope;
        // Une panne du journal des rejets fait remonter l'erreur : la position n'avance pas
        await this.processor.handle({
          source: 'postgres',
          topic: isEventType(row.eventType)
            ? topicFor(row.eventType, EVENT_CATALOG[row.eventType].version)
            : `${row.eventType}.v${row.eventVersion}`,
          partition: 0,
          // Position propre au groupe : deux services peuvent rejeter le même événement
          offset: `${this.options.group}:${row.deliverySeq}`,
          value: JSON.stringify(envelope),
          headers: { correlationId: row.correlationId },
        });
      }
      await this.prisma.eventSubscription.updateMany({
        where: { group: this.options.group, owner: this.instance },
        data: { position: row.deliverySeq },
      });
    }
    return rows.length;
  }
}
