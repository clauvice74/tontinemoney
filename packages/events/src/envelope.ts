import { randomUUID } from 'node:crypto';
import { EVENT_CATALOG, type EventPayload, type EventType, isEventType } from './catalog';

/**
 * Enveloppe normalisée (eventId, eventType, eventVersion, occurredAt, producer, correlationId,
 * causationId, aggregateId, tenantId, payload). `tenantId` : plateforme mono-locataire, toujours
 * null aujourd'hui ; le champ est réservé pour une exploitation multi-opérateurs (A-52).
 */
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
  tenantId: string | null;
  payload: EventPayload<T>;
}

/** Topic Kafka d'un type d'événement : la version fait partie du nom (`payment.completed.v1`). */
export function topicFor(eventType: string, version: number): string {
  return `${eventType}.v${version}`;
}

/** Topic des messages rejetés par les consommateurs (schéma invalide, version, échecs répétés). */
export const DEAD_LETTER_TOPIC = 'tontinemoney.dead-letter.v1';

export interface NewEvent<T extends EventType = EventType> {
  type: T;
  aggregateType: string;
  aggregateId: string;
  payload: EventPayload<T>;
  correlationId?: string | null;
  causationId?: string | null;
  tenantId?: string | null;
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
    tenantId: event.tenantId ?? null,
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
  for (const field of ['causationId', 'tenantId']) {
    const v = e[field];
    if (v !== undefined && v !== null && typeof v !== 'string')
      throw new EventValidationError(`Champ invalide : ${field}`, null);
  }
  if (Number.isNaN(Date.parse(String(e['occurredAt']))))
    throw new EventValidationError('Horodatage invalide : occurredAt', null);
  // Lecteur tolérant : un message antérieur sans tenantId / causationId reste valide
  return {
    ...(e as unknown as EventEnvelope),
    causationId: (e['causationId'] as string | null | undefined) ?? null,
    tenantId: (e['tenantId'] as string | null | undefined) ?? null,
    payload: payload.data as EventEnvelope['payload'],
  };
}
