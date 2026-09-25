import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AccessDecisionInput,
  type CreateTontineAdminInput,
  type RegisterMemberInput,
  accessDecisionSchema,
  createTontineAdminSchema,
  registerMemberSchema,
  unlockUserSchema,
  PLATFORM_ROLES,
  USER_STATUSES,
} from '@tontine/contracts';
import {
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  CurrentUser,
  PrismaService,
  Public,
  Roles,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { z } from 'zod';
import { LoginService } from './login.service';
import { RegistrationService } from './registration.service';
import { TokenService } from './token.service';

const accessRequestsQuery = z.object({
  tontineId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']).optional(),
});

const usersQuery = z.object({
  role: z.enum(PLATFORM_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@ApiTags('Administration — comptes')
@ApiBearerAuth()
@Controller({ version: '1' })
export class AdminUsersController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly login: LoginService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('admin/tontine-admins')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un administrateur de tontine (US-1.1)' })
  @ApiZodBody(createTontineAdminSchema)
  async createTontineAdmin(
    @CurrentUser() actor: Actor,
    @ZodBody(createTontineAdminSchema) body: CreateTontineAdminInput,
  ) {
    return this.registration.createTontineAdmin(actor, body);
  }

  @Post('tontines/:tontineId/members')
  @ApiOperation({
    summary: 'Inscrire un membre dans ma tontine (US-1.2) — admin de la tontine uniquement',
  })
  @ApiZodBody(registerMemberSchema)
  async registerMember(
    @CurrentUser() actor: Actor,
    @Param('tontineId', ParseUUIDPipe) tontineId: string,
    @ZodBody(registerMemberSchema) body: RegisterMemberInput,
  ) {
    return this.registration.registerMember(actor, tontineId, body);
  }

  @Get('access-requests')
  @ApiOperation({
    summary: 'Demandes d’accès à traiter (US-10.1 super-admin ; US-2.4 admin de tontine)',
  })
  @ApiZodQuery(accessRequestsQuery)
  async listAccessRequests(
    @CurrentUser() actor: Actor,
    @ZodQuery(accessRequestsQuery) q: z.infer<typeof accessRequestsQuery>,
  ) {
    return this.registration.listAccessRequests(actor, q);
  }

  @Post('access-requests/:requestId/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepter / refuser une demande (motif obligatoire en cas de refus)' })
  @ApiZodBody(accessDecisionSchema)
  async decide(
    @CurrentUser() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @ZodBody(accessDecisionSchema) body: AccessDecisionInput,
  ) {
    return this.registration.decideAccessRequest(actor, requestId, body);
  }

  @Post('admin/users/:userId/unlock')
  @Roles('SUPER_ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Déverrouiller un compte (R-AUTH-LOGIN-02)' })
  @ApiZodBody(unlockUserSchema)
  async unlock(
    @CurrentUser() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ZodBody(unlockUserSchema) body: { reason: string },
  ): Promise<void> {
    await this.login.unlock(actor, userId, body.reason);
  }

  @Get('admin/users')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Rechercher des comptes (super-admin)' })
  @ApiZodQuery(usersQuery)
  async users(@ZodQuery(usersQuery) q: z.infer<typeof usersQuery>) {
    const rows = await this.prisma.user.findMany({
      where: {
        ...(q.role ? { role: q.role } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
                { email: { contains: q.search } },
                { phone: { contains: q.search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return {
      data: rows.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        role: u.role,
        status: u.status,
        locked: !!u.lockedUntil && u.lockedUntil > new Date(),
        mfaEnabled: u.mfaEnabled,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
    };
  }
}

/** Clés publiques de vérification des access tokens (JWKS, rotation). */
@ApiTags('Authentification')
@Controller({ path: '.well-known', version: VERSION_NEUTRAL })
export class JwksController {
  constructor(private readonly tokens: TokenService) {}

  @Get('jwks.json')
  @Public()
  @ApiOperation({ summary: 'JWKS (RS256)' })
  jwks(): { keys: Array<Record<string, unknown>> } {
    return this.tokens.jwks;
  }
}
