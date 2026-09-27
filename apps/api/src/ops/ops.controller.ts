import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Actor,
  ApiZodQuery,
  CurrentUser,
  DeadLetterService,
  JobRegistry,
  OutboxRelay,
  PrismaService,
  RequirePermission,
  ZodQuery,
} from '@tontine/platform';
import { z } from 'zod';

const deadLettersQuery = z.object({
  status: z.enum(['OPEN', 'REPLAYED', 'DISCARDED']).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const auditQuery = z.object({
  actorId: z.string().uuid().optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(100).optional(),
  result: z.enum(['SUCCESS', 'DENIED', 'FAILURE']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Exploitation (super-admin) : tâches planifiées, DLQ des événements, journal d'audit. */
@ApiTags('Exploitation')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class OpsController {
  constructor(
    private readonly jobs: JobRegistry,
    private readonly relay: OutboxRelay,
    private readonly prisma: PrismaService,
    private readonly deadLetters: DeadLetterService,
  ) {}

  @Get('jobs')
  @RequirePermission('platform.jobs.run')
  @ApiOperation({ summary: 'Tâches planifiées disponibles' })
  listJobs() {
    return { data: this.jobs.list() };
  }

  @Post('jobs/:name/run')
  @RequirePermission('platform.jobs.run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exécuter une tâche planifiée à la demande (démonstration, rattrapage)',
  })
  async runJob(@Param('name') name: string) {
    const result = await this.jobs.run(name, 'manual');
    await this.relay.drain();
    return result;
  }

  @Get('outbox/dead')
  @RequirePermission('platform.outbox.inspect')
  @ApiOperation({ summary: 'Événements en DLQ (échec définitif de publication)' })
  async dead() {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { status: 'DEAD' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        attempts: r.attempts,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Post('outbox/:eventId/requeue')
  @RequirePermission('platform.outbox.inspect')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remettre un événement DLQ en file' })
  async requeue(@Param('eventId', ParseUUIDPipe) eventId: string): Promise<void> {
    await this.relay.requeue(eventId);
  }

  @Get('events/dead-letters')
  @RequirePermission('platform.outbox.inspect')
  @ApiOperation({
    summary: 'Messages rejetés par les consommateurs (validation ou traitement, étape 3)',
  })
  @ApiZodQuery(deadLettersQuery)
  async deadLetterList(@ZodQuery(deadLettersQuery) q: z.infer<typeof deadLettersQuery>) {
    return { data: await this.deadLetters.list(q.status, q.limit) };
  }

  @Post('events/dead-letters/:id/replay')
  @RequirePermission('platform.outbox.inspect')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Rejouer un message rejeté (validation puis traitement idempotent) ; 422 si toujours en échec',
  })
  async deadLetterReplay(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.deadLetters.replay(actor.userId, id);
  }

  @Post('events/dead-letters/:id/discard')
  @RequirePermission('platform.outbox.inspect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Abandonner un message rejeté (conservé pour l’audit)' })
  async deadLetterDiscard(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.deadLetters.discard(actor.userId, id);
  }

  @Get('audit-logs')
  @RequirePermission('platform.outbox.inspect')
  @ApiOperation({ summary: 'Journal d’audit (lecture seule)' })
  @ApiZodQuery(auditQuery)
  async audit(@ZodQuery(auditQuery) q: z.infer<typeof auditQuery>) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.resourceType ? { resourceType: q.resourceType } : {}),
        ...(q.resourceId ? { resourceId: q.resourceId } : {}),
        ...(q.result ? { result: q.result } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return { data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  }
}
