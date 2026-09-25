import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ComplianceRuleInput, type OperationType } from '@tontine/contracts';
import { Prisma, isUniqueViolation } from '@tontine/database';
import {
  type Actor,
  Clock,
  DomainError,
  KvStore,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  UnitOfWork,
} from '@tontine/platform';
import {
  type EvaluationResult,
  type RuleSnapshot,
  evaluate,
  validateParams,
} from './domain/evaluate';

export interface ValidateInput {
  operationType: OperationType;
  memberId: string;
  amountMinor: bigint;
  currency: string;
  /** Membre dont le wallet est crédité (règles WALLET_LIMIT), le cas échéant. */
  creditMemberId?: string | null;
  context?: Record<string, unknown>;
}

/** Types de transactions comptés dans les cumuls d'une règle. */
const OPERATION_TO_TX: Record<OperationType, string[]> = {
  DEPOSIT: ['DEPOSIT'],
  WITHDRAWAL: ['WITHDRAWAL'],
  TRANSFER: ['TRANSFER'],
  TONTINE_CONTRIBUTION: ['CONTRIBUTION', 'PENALTY', 'ENTRY_FEE'],
  TONTINE_PAYOUT: ['PAYOUT'],
  TONTINE_CREATION: [],
  TONTINE_JOIN: [],
};

const CACHE_TTL_SECONDS = 300; // US-9.2 : cache des règles, TTL 5 min
/** US-9.4 : suspension automatique après 5 violations en 24 h. */
export const VIOLATIONS_BEFORE_SUSPENSION = 5;

/** Conformité : validation synchrone des opérations, règles dynamiques, violations (épique 9). */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly kv: KvStore,
    private readonly clock: Clock,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  private cacheKey(country: string): string {
    return `cmp:rules:${country}`;
  }

  async rulesFor(country: string): Promise<RuleSnapshot[]> {
    const cached = await this.kv.get(this.cacheKey(country));
    if (cached) return JSON.parse(cached) as RuleSnapshot[];
    const rows = await this.prisma.complianceRule.findMany({
      where: { countryCode: country, active: true },
    });
    const rules: RuleSnapshot[] = rows.map((r) => ({
      code: r.code,
      countryCode: r.countryCode,
      ruleType: r.ruleType,
      operationTypes: r.operationTypes,
      params: r.params as Record<string, unknown>,
      active: r.active,
    }));
    await this.kv.set(this.cacheKey(country), JSON.stringify(rules), CACHE_TTL_SECONDS);
    return rules;
  }

  async invalidate(country: string): Promise<void> {
    await this.kv.del(this.cacheKey(country));
  }

  private async totalFor(memberId: string, currency: string, rule: RuleSnapshot): Promise<bigint> {
    const types = [...new Set(rule.operationTypes.flatMap((o) => OPERATION_TO_TX[o]))];
    if (types.length === 0) return 0n;
    const now = this.clock.now();
    const since =
      rule.ruleType === 'DAILY_LIMIT'
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const res = await this.prisma.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT coalesce(sum("amountMinor"), 0)::bigint AS total FROM "trx_transactions"
      WHERE "initiatorId" = ${memberId}::uuid AND "currency" = ${currency}
        AND "status" IN ('VALIDATED', 'COMPLETED')
        AND "type"::text IN (${Prisma.join(types)})
        AND "createdAt" >= ${since}`;
    return res[0]?.total ?? 0n;
  }

  /** US-9.2 — validation synchrone d'une opération (< 100 ms, règles en cache). */
  async validate(input: ValidateInput): Promise<EvaluationResult> {
    const member = await this.members.snapshot(input.memberId);
    if (!member) throw new DomainError('NOT_FOUND', 'Membre introuvable');
    const rules = member.country ? await this.rulesFor(member.country) : [];
    const totals: Record<string, bigint> = {};
    for (const r of rules) {
      if (
        (r.ruleType === 'DAILY_LIMIT' || r.ruleType === 'MONTHLY_LIMIT') &&
        r.operationTypes.includes(input.operationType)
      ) {
        totals[r.code] = await this.totalFor(input.memberId, input.currency, r);
      }
    }
    let creditedWalletBalanceMinor: bigint | null = null;
    if (input.creditMemberId) {
      const w = await this.prisma.wallet.findUnique({
        where: { memberId: input.creditMemberId },
        select: { balanceMinor: true },
      });
      creditedWalletBalanceMinor = w?.balanceMinor ?? 0n;
    }
    return evaluate({
      operationType: input.operationType,
      amountMinor: input.amountMinor,
      currency: input.currency,
      member: {
        status: member.status,
        kycLevel: member.kycLevel,
        complianceStatus: member.complianceStatus,
        country: member.country,
      },
      totals,
      creditedWalletBalanceMinor,
      rules,
    });
  }

  /**
   * US-9.4 — valide et, en cas de violation : journalise, publie `compliance.violation.detected`,
   * suspend le membre si la règle l'exige ou après 5 violations en 24 h, puis lève COMPLIANCE_VIOLATION.
   */
  async assertCompliant(input: ValidateInput): Promise<EvaluationResult> {
    const result = await this.validate(input);
    if (result.compliant) return result;
    const suspend = result.violations.some((v) => v.action === 'SUSPEND');
    await this.uow.run(async (tx) => {
      for (const v of result.violations) {
        const row = await tx.complianceViolation.create({
          data: {
            memberId: input.memberId,
            operationType: input.operationType,
            ruleCode: v.rule,
            action: suspend ? 'SUSPENDED' : 'BLOCKED',
            details: {
              ...v,
              amountMinor: input.amountMinor.toString(),
              currency: input.currency,
              context: input.context ?? {},
            } as object,
            createdAt: this.clock.now(),
          },
        });
        await this.outbox.add(tx, {
          type: 'compliance.violation.detected',
          aggregateType: 'member',
          aggregateId: input.memberId,
          payload: {
            violationId: row.id,
            memberId: input.memberId,
            operationType: input.operationType,
            ruleCode: v.rule,
            action: row.action,
          },
        });
      }
      const recent = await tx.complianceViolation.count({
        where: {
          memberId: input.memberId,
          createdAt: { gte: new Date(this.clock.now().getTime() - 86_400_000) },
        },
      });
      if (suspend || recent >= VIOLATIONS_BEFORE_SUSPENSION) {
        await this.outbox.add(tx, {
          type: 'compliance.user.suspended',
          aggregateType: 'member',
          aggregateId: input.memberId,
          payload: {
            memberId: input.memberId,
            reason: suspend
              ? `Règle ${result.violations[0]?.rule}`
              : 'Violations répétées de conformité',
          },
        });
      }
    });
    throw new DomainError(
      'COMPLIANCE_VIOLATION',
      result.violations.map((v) => v.message).join(' ; '),
      {
        violations: result.violations.map(({ rule, message, limit, current }) => ({
          rule,
          message,
          limit,
          current,
        })),
      },
    );
  }

  // ------------------------------------------------------------------ US-9.3 règles dynamiques
  async listRules(country?: string) {
    const rows = await this.prisma.complianceRule.findMany({
      where: country ? { countryCode: country } : {},
      orderBy: [{ countryCode: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async createRule(actor: Actor, input: ComplianceRuleInput) {
    const err = validateParams(input.ruleType, input.params);
    if (err) throw new DomainError('VALIDATION_FAILED', err);
    try {
      const rule = await this.uow.run(async (tx) => {
        const r = await tx.complianceRule.create({
          data: {
            code: input.code,
            countryCode: input.countryCode,
            ruleType: input.ruleType,
            operationTypes: input.operationTypes,
            params: input.params as object,
            active: input.active,
            description: input.description ?? null,
            updatedById: actor.userId,
          },
        });
        await tx.complianceRuleHistory.create({
          data: {
            ruleId: r.id,
            version: 1,
            snapshot: this.snapshot(r),
            change: 'CREATED',
            changedById: actor.userId,
          },
        });
        await this.outbox.add(tx, {
          type: 'compliance.rule.updated',
          aggregateType: 'compliance_rule',
          aggregateId: r.id,
          payload: { ruleCode: r.code, country: r.countryCode, version: 1, change: 'CREATED' },
        });
        return r;
      });
      await this.invalidate(rule.countryCode);
      return rule;
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError('CONFLICT', 'Code de règle déjà utilisé');
      throw e;
    }
  }

  private snapshot(r: {
    ruleType: string;
    operationTypes: string[];
    params: unknown;
    active: boolean;
    description: string | null;
  }) {
    return {
      ruleType: r.ruleType,
      operationTypes: r.operationTypes,
      params: r.params,
      active: r.active,
      description: r.description,
    } as object;
  }

  /** Mise à jour sans redéploiement : effet immédiat (cache invalidé + événement). */
  async updateRule(
    actor: Actor,
    code: string,
    input: {
      params?: Record<string, unknown>;
      active?: boolean;
      operationTypes?: OperationType[];
      description?: string;
      ruleType?: never;
      changeReason: string;
    },
  ) {
    const existing = await this.prisma.complianceRule.findUnique({ where: { code } });
    if (!existing) throw new DomainError('NOT_FOUND', 'Règle introuvable');
    if (input.params) {
      const err = validateParams(existing.ruleType, input.params);
      if (err) throw new DomainError('VALIDATION_FAILED', err);
    }
    const rule = await this.uow.run(async (tx) => {
      const r = await tx.complianceRule.update({
        where: { id: existing.id },
        data: {
          ...(input.params ? { params: input.params as object } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.operationTypes ? { operationTypes: input.operationTypes } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 },
          updatedById: actor.userId,
        },
      });
      await tx.complianceRuleHistory.create({
        data: {
          ruleId: r.id,
          version: r.version,
          snapshot: this.snapshot(r),
          change: 'UPDATED',
          reason: input.changeReason,
          changedById: actor.userId,
        },
      });
      await this.outbox.add(tx, {
        type: 'compliance.rule.updated',
        aggregateType: 'compliance_rule',
        aggregateId: r.id,
        payload: {
          ruleCode: r.code,
          country: r.countryCode,
          version: r.version,
          change: input.changeReason,
        },
      });
      return r;
    });
    await this.invalidate(rule.countryCode);
    return rule;
  }

  async history(code: string) {
    const rule = await this.prisma.complianceRule.findUnique({
      where: { code },
      include: { history: { orderBy: { version: 'desc' } } },
    });
    if (!rule) throw new DomainError('NOT_FOUND', 'Règle introuvable');
    return rule.history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() }));
  }

  async violations(memberId?: string, limit = 100) {
    const rows = await this.prisma.complianceViolation.findMany({
      where: memberId ? { memberId } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }));
  }

  /** US-9.4 — changement de pays suspect : deux changements en 30 jours → compte restreint + alerte. */
  async onCountryChanged(memberId: string, from: unknown, to: unknown): Promise<void> {
    const since = new Date(this.clock.now().getTime() - 30 * 86_400_000);
    const changes = await this.prisma.memberAuditLog.count({
      where: {
        memberId,
        action: 'UPDATED',
        createdAt: { gte: since },
        trigger: { in: ['profile.update'] },
        newValues: { path: ['country'], not: Prisma.AnyNull },
      },
    });
    if (changes < 2) return;
    this.logger.warn(
      `Changement de pays suspect pour ${memberId} (${String(from)} → ${String(to)})`,
    );
    await this.uow.run(async (tx) => {
      const row = await tx.complianceViolation.create({
        data: {
          memberId,
          operationType: 'TRANSFER',
          ruleCode: 'SUSPICIOUS-COUNTRY-CHANGE',
          action: 'ALERTED',
          details: { from, to, changesIn30Days: changes } as object,
          createdAt: this.clock.now(),
        },
      });
      await this.outbox.addMany(tx, [
        {
          type: 'compliance.violation.detected',
          aggregateType: 'member',
          aggregateId: memberId,
          payload: {
            violationId: row.id,
            memberId,
            operationType: 'TRANSFER',
            ruleCode: 'SUSPICIOUS-COUNTRY-CHANGE',
            action: 'ALERTED',
          },
        },
        {
          type: 'compliance.user.restricted',
          aggregateType: 'member',
          aggregateId: memberId,
          payload: { memberId, reason: 'Changements de pays répétés (30 jours)' },
        },
      ]);
    });
  }
}
