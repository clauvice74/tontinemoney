import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isPlatformStaff } from '@tontine/auth';
import {
  PROFILE_PHOTO_MAX_BYTES,
  type ChangeMemberStatusInput,
  type ListMembersQuery,
  type MemberDirectoryParams,
  type MemberHistoryQuery,
  type MemberSearchQuery,
  type NotificationPrefs,
  type UpdateProfileInput,
  changeMemberStatusSchema,
  listMembersQuerySchema,
  memberDirectoryQuerySchema,
  memberHistoryQuerySchema,
  memberSearchQuerySchema,
  notificationPrefsSchema,
  suspendMemberSchema,
  updateProfileSchema,
} from '@tontine/contracts';
import {
  AccessDeniedMonitor,
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  CurrentUser,
  DomainError,
  RequirePermission,
  Roles,
  TONTINE_ACCESS,
  type TontineAccessPort,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { type Response } from 'express';
import { MemberDirectoryQuery } from './member-directory.query';
import { MembersService, toLimitedView, toMemberView } from './members.service';
import { ProfilePhotoStore } from './profile-photo.store';

@ApiTags('Membres')
@ApiBearerAuth()
@Controller({ version: '1' })
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly directory: MemberDirectoryQuery,
    private readonly photos: ProfilePhotoStore,
    private readonly denied: AccessDeniedMonitor,
    @Inject(TONTINE_ACCESS) private readonly tontines: TontineAccessPort,
  ) {}

  @Get('me/profile')
  @ApiOperation({ summary: 'Mon profil membre' })
  async me(@CurrentUser() actor: Actor) {
    return toMemberView(await this.members.get(actor.userId));
  }

  @Patch('me/profile')
  @ApiOperation({
    summary: 'Compléter / modifier mon profil (US-2.2) — verrou optimiste par version',
  })
  @ApiZodBody(updateProfileSchema)
  async update(
    @CurrentUser() actor: Actor,
    @ZodBody(updateProfileSchema) body: UpdateProfileInput,
  ) {
    return this.members.updateProfile(actor, actor.userId, body);
  }

  @Put('me/notification-preferences')
  @ApiOperation({
    summary: 'Préférences de notification (US-8.5) — la sécurité reste toujours active',
  })
  @ApiZodBody(notificationPrefsSchema)
  async prefs(
    @CurrentUser() actor: Actor,
    @ZodBody(notificationPrefsSchema) body: NotificationPrefs,
  ) {
    return this.members.updateNotificationPrefs(actor, body);
  }

  @Post('me/profile/photo')
  @ApiOperation({ summary: 'Photo de profil (JPEG/PNG, 5 Mo max)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PROFILE_PHOTO_MAX_BYTES, files: 1 } }),
  )
  async uploadPhoto(
    @CurrentUser() actor: Actor,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    if (!file) throw new DomainError('VALIDATION_FAILED', 'Fichier « file » requis');
    const ref = await this.photos.save(actor.userId, file.buffer);
    await this.members.setPhoto(actor, ref);
    return { hasPhoto: true };
  }

  @Get('me/profile/photo')
  @ApiOperation({ summary: 'Ma photo de profil' })
  async photo(@CurrentUser() actor: Actor, @Res() res: Response) {
    const m = await this.members.get(actor.userId);
    if (!m.profilePhotoRef) throw new DomainError('NOT_FOUND', 'Aucune photo');
    const { data, type } = await this.photos.read(m.profilePhotoRef);
    res.type(type).setHeader('Cache-Control', 'private, max-age=60').send(data);
  }

  @Get('me/profile/history')
  @ApiOperation({ summary: 'Historique versionné de mon profil (R-MBR-06)' })
  async history(@CurrentUser() actor: Actor) {
    const rows = await this.members.history(actor.userId);
    return {
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        trigger: r.trigger,
        changedByRole: r.changedByRole,
        oldValues: r.oldValues,
        newValues: r.newValues,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Get('members')
  @RequirePermission('platform.members.read')
  @ApiOperation({
    summary: 'Annuaire des membres (personnel) : filtres, recherche, tri, pagination par curseur',
  })
  @ApiZodQuery(memberDirectoryQuerySchema)
  async directoryList(@ZodQuery(memberDirectoryQuerySchema) q: MemberDirectoryParams) {
    await this.members.auditAccess(null, 'member.directory.read_by_staff');
    return this.directory.listPlatform(q);
  }

  @Get('members/search')
  @RequirePermission('platform.members.read')
  @ApiOperation({ summary: 'Rechercher un membre par nom, e-mail ou téléphone (personnel)' })
  @ApiZodQuery(memberSearchQuerySchema)
  async search(@ZodQuery(memberSearchQuerySchema) { q, ...filters }: MemberSearchQuery) {
    await this.members.auditAccess(null, 'member.directory.read_by_staff');
    return this.directory.listPlatform({ ...filters, search: q });
  }

  /**
   * US-2.5 — isolation : un membre ne voit que son propre profil ; un administrateur de tontine
   * partagée voit une vue restreinte ; un co-participant ne voit que nom et prénom.
   */
  @Get('members/:memberId')
  @ApiOperation({ summary: 'Profil d’un membre (contrôle de propriété strict)' })
  async getMember(@CurrentUser() actor: Actor, @Param('memberId', ParseUUIDPipe) memberId: string) {
    if (memberId === actor.userId) return toMemberView(await this.members.get(memberId));
    if (actor.role === 'SUPER_ADMIN' || actor.role === 'KYC_AGENT') {
      const m = await this.members.get(memberId);
      await this.members.auditAccess(memberId, 'member.profile.read_by_staff');
      return toMemberView(m);
    }
    const adminOf = await this.isAdminOfSharedTontine(actor.userId, memberId);
    if (adminOf) return { ...toLimitedView(await this.members.get(memberId)), view: 'LIMITED' };
    if (await this.tontines.shareTontine(actor.userId, memberId)) {
      const m = await this.members.get(memberId);
      return { id: m.id, firstName: m.firstName, lastName: m.lastName, view: 'NAME_ONLY' };
    }
    await this.denied.record('member', memberId, 'not-owner');
    throw new DomainError('FORBIDDEN');
  }

  @Get('members/:memberId/history')
  @ApiOperation({
    summary: 'Historique d’un membre (le membre lui-même ou le personnel ; accès journalisé)',
  })
  @ApiZodQuery(memberHistoryQuerySchema)
  async memberHistory(
    @CurrentUser() actor: Actor,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodQuery(memberHistoryQuerySchema) q: MemberHistoryQuery,
  ) {
    await this.assertSelfOrStaff(actor, memberId);
    const page = await this.members.historyPage(memberId, q);
    if (memberId !== actor.userId)
      await this.members.auditAccess(memberId, 'member.history.read_by_staff');
    return page;
  }

  @Get('members/:memberId/status')
  @ApiOperation({ summary: 'Statut d’un membre (le membre lui-même ou le personnel)' })
  async memberStatus(
    @CurrentUser() actor: Actor,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    await this.assertSelfOrStaff(actor, memberId);
    return this.members.statusView(memberId, isPlatformStaff(actor.role));
  }

  @Patch('members/:memberId/status')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Suspendre (SUSPENDED) ou réactiver (ACTIVE) un membre (super-admin)',
    description:
      'Les autres statuts découlent du parcours KYC et ne peuvent pas être imposés manuellement.',
  })
  @ApiZodBody(changeMemberStatusSchema)
  async changeStatus(
    @CurrentUser() actor: Actor,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(changeMemberStatusSchema) body: ChangeMemberStatusInput,
  ) {
    return body.status === 'SUSPENDED'
      ? this.suspendMember(actor, memberId, body.reason)
      : this.reactivateMember(actor, memberId, body.reason);
  }

  private async assertSelfOrStaff(actor: Actor, memberId: string): Promise<void> {
    if (memberId === actor.userId || isPlatformStaff(actor.role)) return;
    await this.denied.record('member', memberId, 'not-owner');
    throw new DomainError('FORBIDDEN');
  }

  private async isAdminOfSharedTontine(adminId: string, memberId: string): Promise<boolean> {
    const tontineIds = await this.tontines.tontineIdsOf(memberId);
    for (const t of tontineIds) if (await this.tontines.isAdmin(t, adminId)) return true;
    return false;
  }

  /** US-2.3 — liste paginée des membres d'une tontine (admin de CETTE tontine uniquement). */
  @Get('tontines/:tontineId/members')
  @ApiOperation({
    summary: 'Membres d’une tontine : filtres, recherche, tri, pagination par curseur (US-2.3)',
  })
  @ApiZodQuery(listMembersQuerySchema)
  async list(
    @CurrentUser() actor: Actor,
    @Param('tontineId', ParseUUIDPipe) tontineId: string,
    @ZodQuery(listMembersQuerySchema) q: ListMembersQuery,
  ) {
    if (actor.role !== 'SUPER_ADMIN' && !(await this.tontines.isAdmin(tontineId, actor.userId))) {
      await this.denied.record('tontine', tontineId, 'not-admin');
      throw new DomainError('FORBIDDEN');
    }
    return this.directory.list(tontineId, q);
  }

  @Post(['admin/members/:memberId/suspend', 'members/:memberId/suspend'])
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspendre un membre (super-admin)' })
  @ApiZodBody(suspendMemberSchema)
  async suspend(
    @CurrentUser() actor: Actor,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(suspendMemberSchema) body: { reason: string },
  ) {
    return this.suspendMember(actor, memberId, body.reason);
  }

  @Post(['admin/members/:memberId/reactivate', 'members/:memberId/reactivate'])
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lever la suspension d’un membre (super-admin)' })
  @ApiZodBody(suspendMemberSchema)
  async reactivate(
    @CurrentUser() actor: Actor,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @ZodBody(suspendMemberSchema) body: { reason: string },
  ) {
    return this.reactivateMember(actor, memberId, body.reason);
  }

  private async suspendMember(actor: Actor, memberId: string, reason: string) {
    await this.members.get(memberId);
    const changed = await this.members.applyTrigger(memberId, 'admin.suspend', {
      reason,
      changedBy: actor.userId,
      changedByRole: 'SUPER_ADMIN',
    });
    if (!changed) throw new DomainError('INVALID_STATE_TRANSITION', 'Membre déjà suspendu');
    return toMemberView(await this.members.get(memberId));
  }

  private async reactivateMember(actor: Actor, memberId: string, reason: string) {
    await this.members.get(memberId);
    const changed = await this.members.applyTrigger(memberId, 'admin.reactivate', {
      reason,
      changedBy: actor.userId,
      changedByRole: 'SUPER_ADMIN',
    });
    if (!changed) throw new DomainError('INVALID_STATE_TRANSITION', 'Le membre n’est pas suspendu');
    return toMemberView(await this.members.get(memberId));
  }
}
