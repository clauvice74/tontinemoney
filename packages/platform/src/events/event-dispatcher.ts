import { Injectable, Logger } from '@nestjs/common';
import { type EventEnvelope, type EventType } from '@tontine/events';
import { RequestContext } from '../context/request-context';
import { PrismaService } from '../context/prisma.service';

export type EventHandlerFn = (event: EventEnvelope) => Promise<void>;

interface Registration {
  consumer: string;
  handler: EventHandlerFn;
}

export class EventDispatchError extends Error {
  constructor(readonly failures: Array<{ consumer: string; error: unknown }>) {
    super(
      `Échec de ${failures.length} consommateur(s) : ${failures
        .map(
          (f) => `${f.consumer} (${f.error instanceof Error ? f.error.message : String(f.error)})`,
        )
        .join('; ')}`,
    );
    this.name = 'EventDispatchError';
  }
}

/** Distribue un événement à ses consommateurs, de façon idempotente par (consommateur, eventId). */
@Injectable()
export class EventDispatcher {
  private readonly logger = new Logger(EventDispatcher.name);
  private readonly registry = new Map<string, Registration[]>();

  constructor(private readonly prisma: PrismaService) {}

  register(type: EventType, consumer: string, handler: EventHandlerFn): void {
    const list = this.registry.get(type) ?? [];
    if (list.some((r) => r.consumer === consumer)) {
      throw new Error(`Consommateur « ${consumer} » déjà enregistré pour ${type}`);
    }
    list.push({ consumer, handler });
    this.registry.set(type, list);
  }

  subscribedTypes(): string[] {
    return [...this.registry.keys()];
  }

  consumersOf(type: string): string[] {
    return (this.registry.get(type) ?? []).map((r) => r.consumer);
  }

  async dispatch(event: EventEnvelope): Promise<void> {
    const registrations = this.registry.get(event.eventType) ?? [];
    const failures: Array<{ consumer: string; error: unknown }> = [];
    for (const reg of registrations) {
      const already = await this.prisma.processedEvent.findUnique({
        where: { consumer_eventId: { consumer: reg.consumer, eventId: event.eventId } },
      });
      if (already) {
        this.logger.debug(`Événement ${event.eventId} déjà traité par ${reg.consumer} — ignoré`);
        continue;
      }
      try {
        await RequestContext.run(
          { correlationId: event.correlationId, causationId: event.eventId, source: 'event' },
          () => reg.handler(event),
        );
        await this.prisma.processedEvent.createMany({
          data: [{ consumer: reg.consumer, eventId: event.eventId }],
          skipDuplicates: true,
        });
      } catch (error) {
        this.logger.warn(
          `Consommateur ${reg.consumer} en échec sur ${event.eventType} (${event.eventId}) : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        failures.push({ consumer: reg.consumer, error });
      }
    }
    if (failures.length) throw new EventDispatchError(failures);
  }
}
