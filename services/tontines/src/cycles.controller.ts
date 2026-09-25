import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CONTRIBUTION_STATUSES,
  type TontineAccountInput,
  designateBeneficiarySchema,
  drawOrderSchema,
  priorityRequestSchema,
  tontineAccountSchema,
} from '@tontine/contracts';
import { type Actor, ApiZodBody, CurrentUser, Idempotent, ZodBody } from '@tontine/platform';
import { z } from 'zod';
import { AccountsService } from './accounts.service';
import { ContributionsService } from './contributions.service';
import { CyclesService } from './cycles.service';
import { TontinesService } from './tontines.service';

const statusQuery = z.enum(CONTRIBUTION_STATUSES).optional();

@ApiTags('Tontines — cycles et contributions')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CyclesController {
  constructor(
    private readonly cycles: CyclesService,
    private readonly contributions: ContributionsService,
    private readonly accounts: AccountsService,
    private readonly tontines: TontinesService,
  ) {}

  @Post('tontines/:id/start')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Démarrer maintenant si la date est atteinte et les conditions remplies (admin) — US-4.3',
  })
  async start(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const t = await this.tontines.getAdministered(actor, id, false);
    return this.cycles.startNow(t);
  }

  @Get('tontines/:id/start-check')
  @ApiOperation({ summary: 'Conditions de démarrage non remplies (admin)' })
  async startCheck(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const t = await this.tontines.getAdministered(actor, id);
    return { blockers: await this.cycles.startBlockers(t) };
  }

  @Put('tontines/:id/draw-order')
  @ApiOperation({
    summary: 'Ordre de passage (mode ordre fixe ; après démarrage : cycles futurs uniquement)',
  })
  @ApiZodBody(drawOrderSchema)
  async drawOrder(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(drawOrderSchema) body: { memberIds: string[] },
  ) {
    return this.cycles.setDrawOrder(actor, id, body.memberIds);
  }

  @Get('tontines/:id/draw-proof')
  @ApiOperation({ summary: 'Preuve du tirage (graine, hash SHA-256, horodatage, vérification)' })
  async drawProof(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.drawProof(actor, id);
  }

  @Post('tontines/:id/priority-requests')
  @ApiOperation({ summary: 'Demande prioritaire motivée (mode besoin prioritaire, A-15)' })
  @ApiZodBody(priorityRequestSchema)
  async priority(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(priorityRequestSchema) body: { reason: string },
  ) {
    return this.cycles.requestPriority(actor, id, body.reason);
  }

  @Get('tontines/:id/priority-requests')
  @ApiOperation({ summary: 'Demandes prioritaires (admin : toutes ; membre : les siennes)' })
  async priorities(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.cycles.priorityRequests(actor, id) };
  }

  @Post('tontines/:id/cycles/:cycleId/beneficiary')
  @HttpCode(200)
  @ApiOperation({ summary: 'Désigner le bénéficiaire d’un cycle (admin, mode besoin prioritaire)' })
  @ApiZodBody(designateBeneficiarySchema)
  async designate(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @ZodBody(designateBeneficiarySchema) body: { memberId: string },
  ) {
    return this.cycles.designate(actor, id, cycleId, body.memberId);
  }

  @Get('tontines/:id/cycles')
  @ApiOperation({ summary: 'Cycles de la tontine' })
  async list(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.cycles.cycles(actor, id) };
  }

  @Get('tontines/:id/cycles/:cycleId')
  @ApiOperation({
    summary: 'Détail d’un cycle (admin : toutes les contributions ; membre : la sienne)',
  })
  async one(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
  ) {
    return this.cycles.cycle(actor, id, cycleId);
  }

  @Post('tontines/:id/contributions/:contributionId/pay')
  @Idempotent('tontine.contribution.pay')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Payer sa contribution depuis le wallet (hold + capture, pénalité incluse) — US-5.4',
  })
  async pay(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
  ) {
    return this.contributions.pay(actor, id, contributionId);
  }

  @Post('tontines/:id/entry-fee/pay')
  @Idempotent('tontine.entry-fee.pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Payer le droit d’entrée (avant démarrage)' })
  async entryFee(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.contributions.payEntryFee(actor, id);
  }

  @Get('me/contributions')
  @ApiOperation({ summary: 'Mes échéances (toutes tontines)' })
  async mine(@CurrentUser() actor: Actor, @Query('status') status?: string) {
    return { data: await this.contributions.mine(actor, statusQuery.parse(status || undefined)) };
  }

  @Get('tontines/:id/accounts')
  @ApiOperation({ summary: 'Comptes de la tontine (US-10.2)' })
  async accountsList(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.accounts.list(actor, id) };
  }

  @Post('tontines/:id/accounts')
  @ApiOperation({
    summary: 'Créer un compte (solidarité, épargne, prêt) — configuration uniquement en V1',
  })
  @ApiZodBody(tontineAccountSchema)
  async accountsCreate(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(tontineAccountSchema) body: TontineAccountInput,
  ) {
    return this.accounts.create(actor, id, body);
  }
}
