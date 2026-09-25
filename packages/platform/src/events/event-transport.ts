import { Logger } from '@nestjs/common';
import { type EventEnvelope, parseEnvelope } from '@tontine/events';
import { Kafka, type Consumer, type Producer, logLevel } from 'kafkajs';
import { type EventDispatcher } from './event-dispatcher';

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

/**
 * Transport Kafka / Redpanda : topic = type d'événement, clé = identifiant d'agrégat.
 * Le consommateur du groupe `tontinemoney-api` alimente le même dispatcher (idempotent).
 */
export class KafkaTransport implements EventTransport {
  readonly name = 'kafka';
  private readonly logger = new Logger(KafkaTransport.name);
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;

  constructor(
    brokers: string[],
    private readonly dispatcher: EventDispatcher,
    private readonly groupId = 'tontinemoney-api',
  ) {
    this.kafka = new Kafka({ clientId: 'tontinemoney-api', brokers, logLevel: logLevel.WARN });
  }

  async start(): Promise<void> {
    this.producer = this.kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    await this.producer.connect();
    const topics = this.dispatcher.subscribedTypes();
    if (topics.length === 0) return;
    const admin = this.kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: topics.map((topic) => ({ topic, numPartitions: 3 })),
      waitForLeaders: true,
    });
    await admin.disconnect();
    this.consumer = this.kafka.consumer({ groupId: this.groupId });
    await this.consumer.connect();
    await this.consumer.subscribe({ topics, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message, topic }) => {
        if (!message.value) return;
        try {
          await this.dispatcher.dispatch(parseEnvelope(JSON.parse(message.value.toString('utf8'))));
        } catch (e) {
          // Laisser Kafka rejouer le message : le dispatcher est idempotent.
          this.logger.error(
            `Échec de traitement du message ${topic} : ${e instanceof Error ? e.message : e}`,
          );
          throw e;
        }
      },
    });
  }

  async publish(event: EventEnvelope): Promise<void> {
    if (!this.producer) throw new Error('Producteur Kafka non démarré');
    await this.producer.send({
      topic: event.eventType,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify(event),
          headers: { correlationId: event.correlationId, eventVersion: String(event.eventVersion) },
        },
      ],
    });
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }
}
