import { Logger } from '@nestjs/common';
import {
  DEAD_LETTER_TOPIC,
  EVENT_CATALOG,
  type EventEnvelope,
  isEventType,
  topicFor,
} from '@tontine/events';
import { Kafka, type Consumer, type Producer, logLevel } from 'kafkajs';
import { type EventDispatcher } from './event-dispatcher';
import { type DeadLetterSink, InboxProcessor } from './inbox-processor';

/** Transport de publication des événements relayés depuis l'outbox. */
export interface EventTransport {
  readonly name: string;
  start(): Promise<void>;
  publish(event: EventEnvelope): Promise<void>;
  stop(): Promise<void>;
}

/** Transport in-process : le relais appelle directement le dispatcher (défaut, MVP). */
export class InProcessTransport implements EventTransport {
  readonly name = 'inprocess';
  constructor(private readonly dispatcher: EventDispatcher) {}
  async start(): Promise<void> {}
  async publish(event: EventEnvelope): Promise<void> {
    await this.dispatcher.dispatch(event);
  }
  async stop(): Promise<void> {}
}

export interface KafkaTransportOptions {
  brokers: string[];
  clientId: string;
  groupId: string;
  partitions: number;
  /** Tentatives de traitement avant rejet (InboxProcessor). */
  maxAttempts: number;
  replicationFactor?: number;
}

/** En-têtes Kafka d'un événement : métadonnées de l'enveloppe, lisibles sans désérialiser. */
export function kafkaHeaders(event: EventEnvelope): Record<string, string> {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    eventVersion: String(event.eventVersion),
    producer: event.producer,
    correlationId: event.correlationId,
    ...(event.causationId ? { causationId: event.causationId } : {}),
    ...(event.tenantId ? { tenantId: event.tenantId } : {}),
  };
}

/** Topics à consommer : un par type souscrit, à la version du catalogue. */
export function subscribedTopics(types: string[]): string[] {
  return types.filter(isEventType).map((t) => topicFor(t, EVENT_CATALOG[t].version));
}

/**
 * Transport Kafka / Redpanda (étape 3, A-52) : topic versionné `<type>.v<version>`, clé = agrégat
 * (ordre garanti par agrégat), en-têtes de corrélation. Consommation via InboxProcessor : message
 * invalide ou consommateur en échec après réessais → journal des rejets + topic de rejet, puis
 * acquittement (la partition n'est jamais bloquée). Seule une panne du journal des rejets
 * empêche l'acquittement : le message sera relu, jamais perdu.
 */
export class KafkaTransport implements EventTransport {
  readonly name = 'kafka';
  private readonly logger = new Logger(KafkaTransport.name);
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private readonly processor: InboxProcessor;

  constructor(
    private readonly options: KafkaTransportOptions,
    private readonly dispatcher: EventDispatcher,
    deadLetters: DeadLetterSink,
  ) {
    this.kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.brokers,
      logLevel: logLevel.WARN,
    });
    this.processor = new InboxProcessor(
      dispatcher,
      {
        record: async (entry) => {
          await deadLetters.record(entry);
          await this.producer?.send({
            topic: DEAD_LETTER_TOPIC,
            messages: [
              {
                key: entry.eventId ?? entry.topic ?? 'unknown',
                value: entry.rawMessage,
                headers: {
                  ...(entry.headers ?? {}),
                  'x-dlq-stage': entry.stage,
                  'x-dlq-reason': entry.reason.slice(0, 500),
                  'x-dlq-source-topic': entry.topic ?? '',
                  'x-dlq-consumers': entry.consumers.join(','),
                },
              },
            ],
          });
        },
      },
      { maxAttempts: options.maxAttempts },
    );
  }

  async start(): Promise<void> {
    this.producer = this.kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    await this.producer.connect();
    const topics = subscribedTopics(this.dispatcher.subscribedTypes());
    const admin = this.kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [
        ...topics.map((topic) => ({
          topic,
          numPartitions: this.options.partitions,
          replicationFactor: this.options.replicationFactor ?? 1,
        })),
        {
          topic: DEAD_LETTER_TOPIC,
          numPartitions: 1,
          replicationFactor: this.options.replicationFactor ?? 1,
        },
      ],
      waitForLeaders: true,
    });
    await admin.disconnect();
    if (topics.length === 0) return;
    this.consumer = this.kafka.consumer({ groupId: this.options.groupId });
    await this.consumer.connect();
    await this.consumer.subscribe({ topics, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message, topic, partition }) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(message.headers ?? {}))
          if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(',') : v.toString();
        const outcome = await this.processor.handle({
          source: 'kafka',
          topic,
          partition,
          offset: message.offset,
          value: message.value,
          headers,
        });
        if (outcome !== 'processed') this.logger.warn(`${topic}#${message.offset} : ${outcome}`);
      },
    });
  }

  async publish(event: EventEnvelope): Promise<void> {
    if (!this.producer) throw new Error('Producteur Kafka non démarré');
    await this.producer.send({
      topic: topicFor(event.eventType, event.eventVersion),
      messages: [
        { key: event.aggregateId, value: JSON.stringify(event), headers: kafkaHeaders(event) },
      ],
    });
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }
}
