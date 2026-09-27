import { z } from 'zod';
import { COMPLIANCE_RULE_TYPES, OPERATION_TYPES } from '../enums';
import { countryCodeSchema, reasonSchema, uuidSchema } from './common';

/** US-9.2 — API de validation. */
export const complianceValidateSchema = z.object({
  operationType: z.enum(OPERATION_TYPES),
  memberId: uuidSchema,
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  country: countryCodeSchema.optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

/** US-9.3 — règle dynamique. `params` dépend du type. */
export const complianceRuleSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}-[A-Z0-9-]{3,40}$/, 'Code attendu : CC-NOM-REGLE'),
  countryCode: countryCodeSchema,
  ruleType: z.enum(COMPLIANCE_RULE_TYPES),
  operationTypes: z.array(z.enum(OPERATION_TYPES)).min(1),
  params: z.record(z.string(), z.unknown()),
  active: z.boolean().default(true),
  description: z.string().trim().max(500).optional(),
});
export type ComplianceRuleInput = z.infer<typeof complianceRuleSchema>;

export const complianceRuleUpdateSchema = complianceRuleSchema
  .omit({ code: true, countryCode: true })
  .partial()
  .extend({ changeReason: reasonSchema });

/** Screening AML / sanctions / PEP à la demande d'un membre (personnel KYC). */
export const screeningRequestSchema = z.object({ memberId: uuidSchema }).strict();
export type ScreeningRequest = z.infer<typeof screeningRequestSchema>;

/** Score de risque d'un membre (lecture seule, aucune action automatique). */
export const riskScoreRequestSchema = z.object({ memberId: uuidSchema }).strict();
export type RiskScoreRequest = z.infer<typeof riskScoreRequestSchema>;

export const COMPLIANCE_CASE_TYPES = [
  'AML_SCREENING',
  'DUPLICATE_IDENTITY',
  'RULE_VIOLATION',
  'FRAUD',
] as const;
export const COMPLIANCE_CASE_STATUSES = ['OPEN', 'CLOSED'] as const;
export const CASE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Dossiers de conformité : filtres, tri, pagination par curseur. */
export const complianceCasesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(512).optional(),
    status: z.enum(COMPLIANCE_CASE_STATUSES).optional(),
    type: z.enum(COMPLIANCE_CASE_TYPES).optional(),
    severity: z.enum(CASE_SEVERITIES).optional(),
    memberId: uuidSchema.optional(),
    /** `me` : mes dossiers ; `none` : non assignés ; sinon identifiant d'un agent. */
    assignee: z.union([z.enum(['me', 'none']), uuidSchema]).optional(),
    sort: z.enum(['opened_desc', 'opened_asc']).default('opened_desc'),
  })
  .strict();
export type ComplianceCasesQuery = z.infer<typeof complianceCasesQuerySchema>;

/** Clôture d'un dossier : décision et commentaire obligatoires (piste d'audit). */
export const closeComplianceCaseSchema = z
  .object({ outcome: z.enum(['CONFIRMED', 'DISMISSED']), comment: reasonSchema })
  .strict();
export type CloseComplianceCaseInput = z.infer<typeof closeComplianceCaseSchema>;

/** Assignation d'un dossier : `null` libère le dossier. */
export const assignComplianceCaseSchema = z.object({ assigneeId: uuidSchema.nullable() }).strict();
export type AssignComplianceCaseInput = z.infer<typeof assignComplianceCaseSchema>;

/** Rôles pouvant se voir assigner un dossier de conformité (A-49). */
export const CASE_ASSIGNABLE_ROLES = ['COMPLIANCE_AGENT', 'SUPER_ADMIN'] as const;
