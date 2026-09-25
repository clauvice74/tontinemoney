import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { type AppConfig } from '@tontine/config';
import { CronJob } from 'cron';
import { createHash } from 'node:crypto';
import { PrismaService } from '../context/prisma.service';
import { RequestContext } from '../context/request-context';
import { APP_CONFIG } from '../context/tokens';
import { DomainError } from '../errors/domain-error';
import { MetricsService } from '../observability/metrics.service';
import { SCHEDULED_JOB, type ScheduledJobOptions } from './scheduled-job.decorator';

type JobFn = () => Promise<Record<string, unknown> | void>;

interface RegisteredJob extends ScheduledJobOptions {
  run: JobFn;
}

export interface JobRunResult {
  name: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  summary: Record<string, unknown>;
}

function lockKey(name: string): bigint {
  return BigInt.asIntN(
    64,
    BigInt(`0x${createHash('sha256').update(`job:${name}`).digest('hex').slice(0, 16)}`),
  );
}

/** Registre des tâches planifiées : planification cron + exécution manuelle, verrou consultatif. */
@Injectable()
export class JobRegistry implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobRegistry.name);
  private readonly jobs = new Map<string, RegisteredJob>();
  private readonly crons: CronJob[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        const meta = this.reflector.get<ScheduledJobOptions | undefined>(SCHEDULED_JOB, method);
        if (!meta) continue;
        if (this.jobs.has(meta.name)) throw new Error(`Tâche en double : ${meta.name}`);
        this.jobs.set(meta.name, { ...meta, run: () => (method as JobFn).call(instance) });
      }
    }
    if (!this.config.SCHEDULER_ENABLED) return;
    for (const job of this.jobs.values()) {
      const cron = CronJob.from({
        cronTime: job.cron,
        timeZone: 'UTC',
        start: true,
        onTick: () => void this.run(job.name, 'cron').catch(() => undefined),
      });
      this.crons.push(cron);
    }
    this.logger.log(`${this.jobs.size} tâche(s) planifiée(s)`);
  }

  onApplicationShutdown(): void {
    for (const c of this.crons) void c.stop();
  }

  list(): ScheduledJobOptions[] {
    return [...this.jobs.values()].map(({ name, cron, description }) => ({
      name,
      cron,
      description,
    }));
  }

  async run(name: string, trigger: 'cron' | 'manual' | 'test' = 'manual'): Promise<JobRunResult> {
    const job = this.jobs.get(name);
    if (!job) throw new DomainError('NOT_FOUND', `Tâche inconnue : ${name}`);
    // Réservation atomique : une seule exécution RUNNING récente par tâche (multi-instance).
    const key = lockKey(name);
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`;
      const running = await tx.jobRun.findFirst({
        where: { name, status: 'RUNNING', startedAt: { gt: new Date(Date.now() - 30 * 60_000) } },
      });
      if (running) return null;
      return tx.jobRun.create({ data: { name, trigger, status: 'RUNNING' } });
    });
    if (!record) return { name, status: 'SKIPPED', summary: { reason: 'déjà en cours' } };
    try {
      const summary =
        (await RequestContext.run(
          { source: 'job', correlationId: `job-${name}-${record.id}` },
          () => job.run(),
        )) ?? {};
      await this.prisma.jobRun.update({
        where: { id: record.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), summary: summary as object },
      });
      this.metrics.jobRuns.inc({ job: name, status: 'SUCCESS' });
      return { name, status: 'SUCCESS', summary };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Tâche ${name} en échec : ${message}`);
      await this.prisma.jobRun.update({
        where: { id: record.id },
        data: { status: 'FAILED', finishedAt: new Date(), summary: { error: message } },
      });
      this.metrics.jobRuns.inc({ job: name, status: 'FAILED' });
      return { name, status: 'FAILED', summary: { error: message } };
    }
  }
}
