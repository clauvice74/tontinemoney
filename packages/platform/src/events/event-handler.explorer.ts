import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { type EventEnvelope } from '@tontine/events';
import { EventDispatcher } from './event-dispatcher';
import { ON_EVENT_METADATA, type OnEventMetadata } from './on-event.decorator';

/** Enregistre au démarrage toutes les méthodes décorées par `@OnEvent`. */
@Injectable()
export class EventHandlerExplorer implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly dispatcher: EventDispatcher,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        const meta = this.reflector.get<OnEventMetadata | undefined>(ON_EVENT_METADATA, method);
        if (!meta) continue;
        for (const type of meta.types) {
          this.dispatcher.register(type, meta.consumer, (event: EventEnvelope) =>
            (method as (e: EventEnvelope) => Promise<void>).call(instance, event),
          );
        }
      }
    }
  }
}
