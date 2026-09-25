import { randomUUID } from 'node:crypto';
import { EVENT_CATALOG, type EventPayload, type EventType, isEventType } from './catalog';

/** Enveloppe normalisée (prompt §13 : eventId, eventType, eventVersion, occurredAt, correlationId, causationId, producer, payload). */
export interface EventEnvelope<T extends EventType = EventType> {
  eventId: string;
  eventType: T;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  payload: EventPayload<T>;
}

export interface NewEvent<T extends EventType = EventType> {
  type: T;
  aggregateType: string;
  aggregateId: string;
  payload: EventPayload<T>;
  correlationId?: string | null;
  causationId?: string | null;
  occurredAt?: Date;
}

export class EventValidationError extends Error {
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'EventValidationError';
  }
}

/** Construit et valide une enveloppe. Lève si le payload ne respecte pas le catalogue. */
export function buildEnvelope<T extends EventType>(
  event: NewEvent<T>,
  defaults: { correlationId: string; causationId?: string | null },
): EventEnvelope<T> {
  const entry = EVENT_CATALOG[event.type];
  const parsed = entry.payload.safeParse(event.payload);
  if (!parsed.success) {
    throw new EventValidationError(`Payload invalide pour ${event.type}`, parsed.error.issues);
  }
  return {
    eventId: randomUUID(),
    eventType: event.type,
    eventVersion: entry.version,
    occurredAt: (event.occurredAt ?? new Date()).toISOString(),
    correlationId: event.correlationId ?? defaults.correlationId,
    causationId: event.causationId ?? defaults.causationId ?? null,
    producer: entry.producer,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: parsed.data as EventPayload<T>,
  };
}

/** Valide une enveloppe reçue du bus (Kafka) avant dispatch. */
export function parseEnvelope(raw: unknown): EventEnvelope {
  if (typeof raw !== 'object' || raw === null)
    throw new EventValidationError('Enveloppe absente', null);
  const e = raw as Record<string, unknown>;
  const type = e['eventType'];
  if (typeof type !== 'string' || !isEventType(type)) {
    throw new EventValidationError(`Type d'événement inconnu : ${String(type)}`, null);
  }
  const entry = EVENT_CATALOG[type];
  if (e['eventVersion'] !== entry.version) {
    throw new EventValidationError(
      `Version non supportée pour ${type}: ${String(e['eventVersion'])}`,
      null,
    );
  }
  const payload = entry.payload.safeParse(e['payload']);
  if (!payload.success)
    throw new EventValidationError(`Payload invalide pour ${type}`, payload.error.issues);
  for (const field of [
    'eventId',
    'occurredAt',
    'correlationId',
    'producer',
    'aggregateType',
    'aggregateId',
  ]) {
    if (typeof e[field] !== 'string')
      throw new EventValidationError(`Champ manquant : ${field}`, null);
  }
  return { ...(e as unknown as EventEnvelope), payload: payload.data as EventEnvelope['payload'] };
}
