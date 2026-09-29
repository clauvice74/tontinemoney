import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateInvitationInput,
  type CreateTontineInput,
  type UpdateTontineInput,
  createInvitationSchema,
  createTontineSchema,
  reasonSchema,
  respondInvitationSchema,
  updateTontineSchema,
} from '@tontine/contracts';
import { type Actor, ApiZodBody, CurrentUser, Public, Roles, ZodBody } from '@tontine/platform';
import { z } from 'zod';
import { InvitationsService } from './invitations.service';
import { TontinesService } from './tontines.service';

const cancelSchema = z.object({ reason: reasonSchema });
const codeParam = z
  .string()
  .trim()
  .min(10)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

@ApiTags('Tontines')
@ApiBearerAuth()
@Controller({ version: '1' })
export class TontinesController {
  constructor(
    private readonly tontines: TontinesService,
    private readonly invitations: InvitationsService,
  ) {}

  @Post('tontines')
  @Roles('MEMBER', 'TONTINE_ADMIN')
  @ApiOperation({ summary: 'Créer une tontine (US-4.1) — KYC TIER_3 ou délégation du super-admin' })
  @ApiZodBody(createTontineSchema)
  async create(
    @CurrentUser() actor: Actor,
    @ZodBody(createTontineSchema) body: CreateTontineInput,
  ) {
    return this.tontines.create(actor, body);
  }

  @Get('tontines')
  @ApiOperation({ summary: 'Mes tontines (participant ou admin)' })
  async mine(@CurrentUser() actor: Actor) {
    return { data: await this.tontines.listMine(actor) };
  }

  @Get('tontines/:id')
  @ApiOperation({ summary: 'Détail d’une tontine (participants et super-admin)' })
  async one(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.tontines.view(actor, id);
  }

  @Get('tontines/:id/participants')
  @ApiOperation({ summary: 'Participants (prénom, rôle, position — sans montants individuels)' })
  async participants(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.tontines.participants(actor, id) };
  }

  @Patch('tontines/:id')
  @ApiOperation({
    summary:
      'Modifier la configuration avant démarrage (admin, A-61) : brouillon, aucun autre membre engagé',
  })
  @ApiZodBody(updateTontineSchema)
  async update(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateTontineSchema) body: UpdateTontineInput,
  ) {
    return this.tontines.update(actor, id, body);
  }

  @Post('tontines/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annuler une tontine avant démarrage (admin)' })
  @ApiZodBody(cancelSchema)
  async cancel(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(cancelSchema) body: { reason: string },
  ) {
    return this.tontines.cancel(actor, id, body.reason);
  }

  // ------------------------------------------------------------------ US-4.2
  @Post('tontines/:id/invitations')
  @ApiOperation({ summary: 'Inviter par email, téléphone ou lien partageable (US-4.2)' })
  @ApiZodBody(createInvitationSchema)
  async invite(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(createInvitationSchema) body: CreateInvitationInput,
  ) {
    return this.invitations.create(actor, id, body);
  }

  @Get('tontines/:id/invitations')
  @ApiOperation({ summary: 'Invitations de la tontine (admin)' })
  async invitationsOf(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.invitations.list(actor, id) };
  }

  @Delete('tontines/:id/invitations/:invitationId')
  @ApiOperation({ summary: 'Révoquer une invitation non acceptée (US-4.2 §7)' })
  async revoke(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revoke(actor, id, invitationId);
  }

  @Get('me/invitations')
  @ApiOperation({ summary: 'Invitations reçues en attente' })
  async myInvitations(@CurrentUser() actor: Actor) {
    return { data: await this.invitations.mine(actor) };
  }

  @Post('invitations/:id/respond')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accepter ou refuser une invitation (éligibilité vérifiée à l’acceptation)',
  })
  @ApiZodBody(respondInvitationSchema)
  async respond(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(respondInvitationSchema) body: { accept: boolean },
  ) {
    return this.invitations.respond(actor, id, body.accept);
  }

  @Post('tontines/:id/invitations/:invitationId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepter une invitation (alias de invitations/{id}/respond)' })
  async accept(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.respond(actor, invitationId, true, id);
  }

  @Post('tontines/:id/invitations/:invitationId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une invitation (alias de invitations/{id}/respond)' })
  async decline(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.respond(actor, invitationId, false, id);
  }

  @Get('invitations/code/:code')
  @Public()
  @ApiOperation({
    summary: 'Aperçu public d’une invitation (nom, montant, fréquence, date de début)',
  })
  async preview(@Param('code') code: string) {
    return this.invitations.preview(codeParam.parse(code));
  }

  @Post('invitations/code/:code/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejoindre via un lien d’invitation' })
  async acceptCode(@CurrentUser() actor: Actor, @Param('code') code: string) {
    return this.invitations.acceptCode(actor, codeParam.parse(code));
  }
}
