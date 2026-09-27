import { SetMetadata } from '@nestjs/common';

export const SCHEDULED_JOB = 'tontine:scheduled-job';

export interface ScheduledJobOptions {
  /** Identifiant stable (utilisé par POST /admin/jobs/{name}/run). */
  name: string;
  /** Expression cron (UTC). */
  cron: string;
  description: string;
}

/** Déclare une tâche planifiée idempotente, exécutable aussi à la demande. */
export const ScheduledJob = (options: ScheduledJobOptions): MethodDecorator =>
  SetMetadata(SCHEDULED_JOB, options);
