import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type ScreeningRequest, screeningRequestSchema } from '@tontine/contracts';
import {
  ApiZodBody,
  AuditService,
  DomainError,
  PrismaService,
  RequirePermission,
  ZodBody,
} from '@tontine/platform';
import { AmlScreeningService, type ScreeningScope } from './aml-screening.service';

/**
 * Screening à la demande (US-3.5) : même moteur que le screening quotidien. Les nouvelles
 * correspondances ouvrent une revue humaine (`kyc.aml.match` → dossier de conformité) ;
 * aucune décision automatique n'est prise ici.
 */
@ApiTags('KYC')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ScreeningController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly screening: AmlScreeningService,
    private readonly audit: AuditService,
  ) {}

  @Post('aml/check')
  @HttpCode(200)
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Screening AML complet d’un membre (sanctions + PEP)' })
  @ApiZodBody(screeningRequestSchema)
  async aml(@ZodBody(screeningRequestSchema) body: ScreeningRequest) {
    return this.run(body.memberId, 'ALL');
  }

  @Post('sanctions/check')
  @HttpCode(200)
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Screening sanctions d’un membre (OFAC, ONU, UE, Interpol)' })
  @ApiZodBody(screeningRequestSchema)
  async sanctions(@ZodBody(screeningRequestSchema) body: ScreeningRequest) {
    return this.run(body.memberId, 'SANCTIONS');
  }

  @Post('pep/check')
  @HttpCode(200)
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Screening PEP (personne politiquement exposée) d’un membre' })
  @ApiZodBody(screeningRequestSchema)
  async pep(@ZodBody(screeningRequestSchema) body: ScreeningRequest) {
    return this.run(body.memberId, 'PEP');
  }

  private async run(memberId: string, scope: ScreeningScope) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
    });
    if (!member) throw new DomainError('NOT_FOUND', 'Membre introuvable');
    const { hits, whitelisted } = await this.screening.screenMember(member, scope, 'ON_DEMAND');
    await this.audit.record({
      action: 'kyc.screening.on_demand',
      resourceType: 'member',
      resourceId: memberId,
      result: 'SUCCESS',
    });
    return {
      memberId,
      scope,
      clear: hits.length === 0,
      newMatches: hits.filter((h) => h.isNew).length,
      whitelisted,
      hits,
    };
  }
}
