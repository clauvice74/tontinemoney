import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CloseComplianceCaseInput,
  type ComplianceCasesQuery,
  type ComplianceRuleInput,
  type OperationType,
  type RiskScoreRequest,
  closeComplianceCaseSchema,
  complianceCasesQuerySchema,
  complianceRuleSchema,
  complianceRuleUpdateSchema,
  complianceValidateSchema,
  riskScoreRequestSchema,
} from '@tontine/contracts';
import {
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  CurrentUser,
  RequirePermission,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { z } from 'zod';
import { ComplianceCasesService } from './cases.service';
import { ComplianceService } from './compliance.service';

const listQuery = z.object({ country: z.string().length(2).toUpperCase().optional() });
const violationsQuery = z.object({
  memberId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@ApiTags('Conformité')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly cases: ComplianceCasesService,
  ) {}

  /** US-9.2 — API synchrone de validation (usage interne / staff). */
  @Post('compliance/validate')
  @HttpCode(200)
  @RequirePermission('compliance.validate')
  @ApiOperation({
    summary: 'Valider une opération (US-9.2) — {compliant, appliedRules, violations}',
  })
  @ApiZodBody(complianceValidateSchema)
  async validate(
    @ZodBody(complianceValidateSchema) body: z.infer<typeof complianceValidateSchema>,
  ) {
    const r = await this.compliance.validate({
      operationType: body.operationType as OperationType,
      memberId: body.memberId,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency.toUpperCase(),
      context: body.context,
    });
    return {
      compliant: r.compliant,
      applied_rules: r.appliedRules,
      appliedRules: r.appliedRules,
      violations: r.violations,
    };
  }

  @Get('admin/compliance/rules')
  @RequirePermission('compliance.rules.manage')
  @ApiOperation({ summary: 'Catalogue des règles par pays' })
  @ApiZodQuery(listQuery)
  async rules(@ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return { data: await this.compliance.listRules(q.country) };
  }

  @Post('admin/compliance/rules')
  @RequirePermission('compliance.rules.manage')
  @ApiOperation({ summary: 'Créer une règle (US-9.3)' })
  @ApiZodBody(complianceRuleSchema)
  async create(
    @CurrentUser() actor: Actor,
    @ZodBody(complianceRuleSchema) body: ComplianceRuleInput,
  ) {
    return this.compliance.createRule(actor, body);
  }

  @Patch('admin/compliance/rules/:code')
  @RequirePermission('compliance.rules.manage')
  @ApiOperation({ summary: 'Modifier une règle — effet immédiat, sans redéploiement (US-9.3)' })
  @ApiZodBody(complianceRuleUpdateSchema)
  async update(
    @CurrentUser() actor: Actor,
    @Param('code') code: string,
    @ZodBody(complianceRuleUpdateSchema) body: z.infer<typeof complianceRuleUpdateSchema>,
  ) {
    return this.compliance.updateRule(actor, code, body as never);
  }

  @Get('admin/compliance/rules/:code/history')
  @RequirePermission('compliance.rules.manage')
  @ApiOperation({ summary: 'Historique des modifications d’une règle' })
  async history(@Param('code') code: string) {
    return { data: await this.compliance.history(code) };
  }

  @Get('admin/compliance/violations')
  @RequirePermission('compliance.rules.manage')
  @ApiOperation({ summary: 'Violations détectées (US-9.4)' })
  @ApiZodQuery(violationsQuery)
  async violations(@ZodQuery(violationsQuery) q: z.infer<typeof violationsQuery>) {
    return { data: await this.compliance.violations(q.memberId, q.limit) };
  }

  @Get('compliance/cases')
  @RequirePermission('compliance.cases.manage')
  @ApiOperation({ summary: 'Dossiers de conformité : filtres, tri, pagination par curseur' })
  @ApiZodQuery(complianceCasesQuerySchema)
  async listCases(@ZodQuery(complianceCasesQuerySchema) q: ComplianceCasesQuery) {
    return this.cases.list(q);
  }

  @Get('compliance/cases/:id')
  @RequirePermission('compliance.cases.manage')
  @ApiOperation({ summary: 'Détail d’un dossier et de ses alertes' })
  async getCase(@Param('id', ParseUUIDPipe) id: string) {
    return this.cases.get(id);
  }

  @Post('compliance/cases/:id/close')
  @HttpCode(200)
  @RequirePermission('compliance.cases.manage')
  @ApiOperation({
    summary: 'Clore un dossier (CONFIRMED | DISMISSED, commentaire obligatoire)',
    description:
      'Refusé (422) tant qu’une correspondance AML ou une alerte doublon du dossier n’a pas été tranchée dans la revue KYC. La clôture ne lève aucune suspension : utiliser /members/{id}/reactivate.',
  })
  @ApiZodBody(closeComplianceCaseSchema)
  async closeCase(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(closeComplianceCaseSchema) body: CloseComplianceCaseInput,
  ) {
    return this.cases.close(actor, id, body);
  }

  @Post(['risk-score', 'fraud/analyze'])
  @HttpCode(200)
  @RequirePermission('compliance.cases.manage')
  @ApiOperation({
    summary: 'Score de risque d’un membre (0–100) et facteurs — lecture seule, aucune action',
  })
  @ApiZodBody(riskScoreRequestSchema)
  async riskScore(@ZodBody(riskScoreRequestSchema) body: RiskScoreRequest) {
    return this.cases.risk(body.memberId);
  }
}
