import { Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ComplianceRuleInput,
  type OperationType,
  complianceRuleSchema,
  complianceRuleUpdateSchema,
  complianceValidateSchema,
} from '@tontine/contracts';
import { type Actor, ApiZodBody, ApiZodQuery, CurrentUser, RequirePermission, ZodBody, ZodQuery } from '@tontine/platform';
import { z } from 'zod';
import { ComplianceService } from './compliance.service';

const listQuery = z.object({ country: z.string().length(2).toUpperCase().optional() });
const violationsQuery = z.object({ memberId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

@ApiTags('Conformité')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** US-9.2 — API synchrone de validation (usage interne / staff). */
  @Post('compliance/validate')
  @HttpCode(200)
  @RequirePermission('compliance.validate')
  @ApiOperation({ summary: 'Valider une opération (US-9.2) — {compliant, appliedRules, violations}' })
  @ApiZodBody(complianceValidateSchema)
  async validate(@ZodBody(complianceValidateSchema) body: z.infer<typeof complianceValidateSchema>) {
    const r = await this.compliance.validate({
      operationType: body.operationType as OperationType,
      memberId: body.memberId,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency.toUpperCase(),
      context: body.context,
    });
    return { compliant: r.compliant, applied_rules: r.appliedRules, appliedRules: r.appliedRules, violations: r.violations };
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
  async create(@CurrentUser() actor: Actor, @ZodBody(complianceRuleSchema) body: ComplianceRuleInput) {
    return this.compliance.createRule(actor, body);
  }

  @Patch('admin/compliance/rules/:code')
  @RequirePermission('compliance.rules.manage')
  @ApiOperation({ summary: 'Modifier une règle — effet immédiat, sans redéploiement (US-9.3)' })
  @ApiZodBody(complianceRuleUpdateSchema)
  async update(@CurrentUser() actor: Actor, @Param('code') code: string, @ZodBody(complianceRuleUpdateSchema) body: z.infer<typeof complianceRuleUpdateSchema>) {
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
}
