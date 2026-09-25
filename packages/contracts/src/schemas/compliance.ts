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
  code: z.string().trim().regex(/^[A-Z]{2}-[A-Z0-9-]{3,40}$/, 'Code attendu : CC-NOM-REGLE'),
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
