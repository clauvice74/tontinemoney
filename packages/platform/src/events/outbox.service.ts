import { Injectable } from '@nestjs/common';
import { type TxClient } from '@tontine/database';
import { type EventEnvelope, type EventType, type NewEvent, buildEnvelope } from '@tontine/events';
import { RequestContext } from '../context/request-context';

/**
 * Outbox transactionnel : l'événement est écrit dans la même transaction SQL que le
 * changement métier, puis publié par le relais (garantie « au moins une fois »).
 */
@Injectable()
export class OutboxService {
  async add<T extends EventType>(tx: TxClient, event: NewEvent<T>): Promise<EventEnvelope<T>> {
    const [env] = await this.addMany(tx, [event]);
    return env as EventEnvelope<T>;
  }

  async addMany(tx: TxClient, events: NewEvent[]): Promise<EventEnvelope[]> {
    if (events.length === 0) return [];
    const ctx = RequestContext.current();
    const envelopes = events.map((e) =>
      buildEnvelope(e, {
        correlationId: ctx?.correlationId ?? 'system',
        causationId: ctx?.causationId ?? null,
      }),
    );
    await tx.outboxEvent.createMany({
      data: envelopes.map((env) => ({
        id: env.eventId,
        eventType: env.eventType,
        eventVersion: env.eventVersion,
        aggregateType: env.aggregateType,
        aggregateId: env.aggregateId,
        producer: env.producer,
        correlationId: env.correlationId,
        causationId: env.causationId,
        payload: env.payload as object,
        occurredAt: new Date(env.occurredAt),
      })),
    });
    return envelopes;
  }
}
