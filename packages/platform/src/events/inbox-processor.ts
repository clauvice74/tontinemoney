import { Logger } from '@nestjs/common';
import { type EventEnvelope, EventValidationError, parseEnvelope, topicFor } from '@tontine/events';
import { EventDispatchError, type EventDispatcher } from './event-dispatcher';

/** Message reçu d'un transport (Kafka) ou rejoué depuis la file des messages rejetés. */
export interface InboundMessage {
  source: 'kafka' | 'inprocess';
  topic?: string;
  partition?: number;
  offset?: string;
  value: Buffer | string | null;
  headers?: Record<string, string>;
}

export interface DeadLetterEntry {
  source: InboundMessage['source'];
  topic: string | null;
  partition: number | null;
  offset: string | null;
  eventId: string | null;
  eventType: string | null;
  eventVersion: number | null;
  stage: 'VALIDATION' | 'PROCESSING';
  consumers: string[];
  reason: string;
  rawMessage: string;
  headers: Record<string, string> | null;
  attempts: number;
}

/** Destination des messages rejetés (base + topic de rejet pour Kafka). */
export interface DeadLetterSink {
  record(entry: DeadLetterEntry): Promise<void>;
}

export type InboxOutcome = 'processed' | 'dead-letter:validation' | 'dead-letter:processing';

export interface InboxOptions {
  /** Tentatives de traitement avant rejet (≥ 1). */
  maxAttempts: number;
  /** Attente avant la tentative n+1 (ms) ; la dernière valeur est réutilisée. */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RAW = 256 * 1024;

/**
 * Traitement d'un message entrant (étape 3, A-52) :
 * 1. validation : JSON, enveloppe (type connu, version supportée, payload conforme au catalogue),
 *    cohérence avec le topic versionné — échec : rejet immédiat (inutile de réessayer) ;
 * 2. traitement : dispatch idempotent (inbox `processed_events` par consommateur), réessais
 *    bornés avec attente exponentielle — échec persistant : rejet avec la liste des consommateurs.
 * Un message rejeté est consigné puis acquitté : il ne bloque jamais la partition.
 */
export class InboxProcessor {
  private readonly logger = new Logger(InboxProcessor.name);
  private readonly backoff: number[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly sink: DeadLetterSink,
    private readonly options: InboxOptions,
  ) {
    this.backoff = options.backoffMs ?? [200, 1000, 5000];
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Validation seule (réutilisée par le rejeu administrateur). */
  static validate(msg: InboundMessage): EventEnvelope {
    const text = msg.value === null ? '' : msg.value.toString();
    if (!text) throw new EventValidationError('Message vide', null);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new EventValidationError('Message JSON illisible', null);
    }
    const envelope = parseEnvelope(raw);
    const expected = topicFor(envelope.eventType, envelope.eventVersion);
    if (msg.topic && msg.topic !== expected)
      throw new EventValidationError(`Topic ${msg.topic} incohérent (attendu : ${expected})`, null);
    return envelope;
  }

  async handle(msg: InboundMessage): Promise<InboxOutcome> {
    let envelope: EventEnvelope;
    try {
      envelope = InboxProcessor.validate(msg);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await this.reject(msg, null, 'VALIDATION', reason, [], 1);
      return 'dead-letter:validation';
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        await this.dispatcher.dispatch(envelope);
        return 'processed';
      } catch (e) {
        lastError = e;
        if (attempt < this.options.maxAttempts)
          await this.sleep(this.backoff[Math.min(attempt - 1, this.backoff.length - 1)] ?? 1000);
      }
    }
    const consumers =
      lastError instanceof EventDispatchError ? lastError.failures.map((f) => f.consumer) : [];
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    await this.reject(msg, envelope, 'PROCESSING', reason, consumers, this.options.maxAttempts);
    return 'dead-letter:processing';
  }

  private async reject(
    msg: InboundMessage,
    envelope: EventEnvelope | null,
    stage: DeadLetterEntry['stage'],
    reason: string,
    consumers: string[],
    attempts: number,
  ): Promise<void> {
    const text = msg.value === null ? '' : msg.value.toString();
    this.logger.error(
      `Message rejeté (${stage}) ${msg.topic ?? msg.source}#${msg.offset ?? '-'} : ${reason}`,
    );
    // Une erreur ici remonte au transport : le message n'est pas acquitté, donc jamais perdu.
    await this.sink.record({
      source: msg.source,
      topic: msg.topic ?? null,
      partition: msg.partition ?? null,
      offset: msg.offset ?? null,
      eventId: envelope?.eventId ?? null,
      eventType: envelope?.eventType ?? null,
      eventVersion: envelope?.eventVersion ?? null,
      stage,
      consumers,
      reason: reason.slice(0, 2000),
      rawMessage: text.slice(0, MAX_RAW),
      headers: msg.headers ?? null,
      attempts,
    });
  }
}
