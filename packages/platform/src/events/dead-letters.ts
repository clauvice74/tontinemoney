import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '@tontine/database';
import { PrismaService } from '../context/prisma.service';
import { DomainError } from '../errors/domain-error';
import { MetricsService } from '../observability/metrics.service';
import { EventDispatcher } from './event-dispatcher';
import { type DeadLetterEntry, type DeadLetterSink, InboxProcessor } from './inbox-processor';

/** Journal des messages rejetés (`platform.event_dead_letters`). */
@Injectable()
export class DeadLetterStore implements DeadLetterSink {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async record(entry: DeadLetterEntry): Promise<void> {
    try {
      await this.prisma.eventDeadLetter.create({
        data: { ...entry, headers: entry.headers ?? undefined },
      });
    } catch (e) {
      // Redélivrance Kafka du même message (topic, partition, offset) : déjà consigné
      if (!isUniqueViolation(e)) throw e;
    }
    if (this.metrics.enabled) this.metrics.deadLetters.inc({ stage: entry.stage });
  }
}

/** Consultation, rejeu et abandon des messages rejetés (super-admin). */
@Injectable()
export class DeadLetterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: EventDispatcher,
  ) {}

  async list(status: 'OPEN' | 'REPLAYED' | 'DISCARDED' = 'OPEN', limit = 100) {
    const rows = await this.prisma.eventDeadLetter.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      topic: r.topic,
      partition: r.partition,
      offset: r.offset,
      eventId: r.eventId,
      eventType: r.eventType,
      eventVersion: r.eventVersion,
      stage: r.stage,
      consumers: r.consumers,
      reason: r.reason,
      attempts: r.attempts,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Rejeu (après correction d'un consommateur ou du catalogue) : même validation que le
   * transport, puis dispatch idempotent — seuls les consommateurs qui n'ont pas encore traité
   * l'événement l'exécutent. Échec : le message reste OPEN, tentatives incrémentées.
   */
  async replay(actorId: string, id: string) {
    const row = await this.open(id);
    let envelope;
    try {
      envelope = InboxProcessor.validate({
        source: 'inprocess',
        value: row.rawMessage,
        ...(row.topic ? { topic: row.topic } : {}),
      });
    } catch (e) {
      await this.bump(id, e);
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        `Message toujours invalide : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      await this.dispatcher.dispatch(envelope);
    } catch (e) {
      await this.bump(id, e);
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        `Traitement toujours en échec : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return this.resolve(actorId, id, 'REPLAYED');
  }

  async discard(actorId: string, id: string) {
    await this.open(id);
    return this.resolve(actorId, id, 'DISCARDED');
  }

  private async open(id: string) {
    const row = await this.prisma.eventDeadLetter.findUnique({ where: { id } });
    if (!row) throw new DomainError('NOT_FOUND', 'Message rejeté introuvable');
    if (row.status !== 'OPEN')
      throw new DomainError('INVALID_STATE_TRANSITION', 'Message déjà traité');
    return row;
  }

  private async bump(id: string, e: unknown) {
    await this.prisma.eventDeadLetter.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        reason: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
      },
    });
  }

  private async resolve(actorId: string, id: string, status: 'REPLAYED' | 'DISCARDED') {
    const res = await this.prisma.eventDeadLetter.updateMany({
      where: { id, status: 'OPEN' },
      data: { status, resolvedBy: actorId, resolvedAt: new Date() },
    });
    if (res.count !== 1) throw new DomainError('INVALID_STATE_TRANSITION', 'Message déjà traité');
    return { id, status };
  }
}
