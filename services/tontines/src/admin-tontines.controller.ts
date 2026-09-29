import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type TargetedMessageInput,
  forcePayoutSchema,
  pauseTontineSchema,
  targetedMessageSchema,
} from '@tontine/contracts';
import {
  type Actor,
  ApiZodBody,
  CurrentUser,
  DomainError,
  PrismaService,
  Roles,
  ZodBody,
} from '@tontine/platform';
import { DashboardService } from './dashboard.service';
import { PayoutsService } from './payouts.service';
import { TontinesService, tontineView } from './tontines.service';

@ApiTags('Tontines — pilotage')
@ApiBearerAuth()
@Controller({ version: '1' })
export class TontineOpsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly dashboards: DashboardService,
    private readonly tontines: TontinesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('tontines/:id/dashboard')
  @ApiOperation({
    summary: 'Tableau de bord (US-4.10) : vue admin ou vue membre, rafraîchissement 30 s',
  })
  async dashboard(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.dashboards.dashboard(actor, id);
  }

  @Post('tontines/:id/cycles/:cycleId/force-payout')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Paiement partiel explicite du pot (admin, journalisé) — A-10 ; exécution asynchrone (saga, A-53)',
  })
  @ApiZodBody(forcePayoutSchema)
  async forcePayout(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @ZodBody(forcePayoutSchema) body: { reason: string },
  ) {
    return this.payouts.forcePayout(actor, id, cycleId, body.reason);
  }

  @Get('tontines/:id/closure-check')
  @ApiOperation({ summary: 'Conditions de clôture non remplies (admin)' })
  async closureCheck(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.tontines.getAdministered(actor, id);
    return { blockers: await this.payouts.closureBlockers(id) };
  }

  @Post('tontines/:id/messages')
  @ApiOperation({ summary: 'Message ciblé aux membres (US-10.3)' })
  @ApiZodBody(targetedMessageSchema)
  async send(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(targetedMessageSchema) body: TargetedMessageInput,
  ) {
    return this.dashboards.sendMessage(actor, id, body);
  }

  @Get('tontines/:id/messages')
  @ApiOperation({ summary: 'Historique des messages envoyés (admin)' })
  async list(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.dashboards.messages(actor, id) };
  }

  @Get('admin/tontines')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Toutes les tontines (super-admin)' })
  async all() {
    const rows = await this.prisma.tontine.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        _count: {
          select: {
            members: { where: { status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION'] } } },
          },
        },
      },
    });
    return { data: rows.map((t) => tontineView(t, { memberCount: t._count.members })) };
  }

  @Post('admin/tontines/:id/pause')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mettre une tontine en pause (paiements et pénalités suspendus)' })
  @ApiZodBody(pauseTontineSchema)
  async pause(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(pauseTontineSchema) body: { reason: string },
  ) {
    return this.payouts.setPaused(actor, id, true, body.reason);
  }

  @Post('admin/tontines/:id/close')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Relancer la clôture (US-4.9, A-61) : clôture si tous les cycles sont terminés et rien n’est impayé, sinon renvoie les blocages',
  })
  async close(@Param('id', ParseUUIDPipe) id: string) {
    const exists = await this.prisma.tontine.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new DomainError('NOT_FOUND', 'Tontine introuvable');
    return this.payouts.tryClose(id);
  }

  @Post('admin/tontines/:id/resume')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reprendre une tontine en pause' })
  @ApiZodBody(pauseTontineSchema)
  async resume(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(pauseTontineSchema) body: { reason: string },
  ) {
    return this.payouts.setPaused(actor, id, false, body.reason);
  }
}
