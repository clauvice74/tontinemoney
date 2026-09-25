import { SetMetadata } from '@nestjs/common';
import { type EventType } from '@tontine/events';

export const ON_EVENT_METADATA = 'tontine:on-event';

export interface OnEventOptions {
  /** Nom stable du consommateur (clé d'idempotence avec l'eventId). */
  consumer: string;
}

export interface OnEventMetadata extends OnEventOptions {
  types: EventType[];
}

/**
 * Déclare un consommateur d'événement. Le dispatcher garantit qu'un même événement
 * n'est traité qu'une fois par consommateur (`processed_events`).
 */
export function OnEvent(types: EventType | EventType[], options: OnEventOptions): MethodDecorator {
  return SetMetadata<string, OnEventMetadata>(ON_EVENT_METADATA, {
    types: Array.isArray(types) ? types : [types],
    ...options,
  });
}
