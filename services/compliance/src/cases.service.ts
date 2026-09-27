import { Inject, Injectable } from '@nestjs/common';
import {
  CASE_ASSIGNABLE_ROLES,
  type CloseComplianceCaseInput,
  type ComplianceCasesQuery,
  buildPage,
  decodeCursor,
} from '@tontine/contracts';
import {
  type ComplianceAlertType,
  type ComplianceCase,
  type ComplianceCaseAlert,
  type ComplianceCaseType,
  isUniqueViolation,
} from '@tontine/database';
import {
  ACCOUNT_DIRECTORY,
  type AccountDirectoryPort,
  type Actor,
  AuditService,
  Clock,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  UnitOfWork,
} from '@tontine/platform';
import { type Severity, maxSeverity, riskScore, violationSeverity } from './domain/risk';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

export interface AlertInput {
  memberId: string;
  caseType: ComplianceCaseType;
  alertType: ComplianceAlertType;
  sourceId: string;
  summary: Record<string, unknown>;
  /** true : l'alerte source attend une décision dans son propre circuit (revue AML, doublon). */
  open: boolean;
  severity: Severity;
}

type CaseWithAlerts = ComplianceCase & { alerts: ComplianceCaseAlert[] };

function toCaseView(c: ComplianceCase, alerts?: ComplianceCaseAlert[]) {
  return {
    id: c.id,
    memberId: c.memberId,
    type: c.type,
    status: c.status,
    severity: c.severity,
    openedAt: c.openedAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    closedAt: c.closedAt?.toISOString() ?? null,
    closedBy: c.closedBy,
    outcome: c.outcome,
    closingComment: c.closingComment,
    assigneeId: c.assigneeId,
    assignedAt: c.assignedAt?.toISOString() ?? null,
    version: c.version,
    ...(alerts
      ? {
          alerts: alerts.map((a) => ({
            id: a.id,
            alertType: a.alertType,
            sourceId: a.sourceId,
            summary: a.summary,
            open: a.open,
            createdAt: a.createdAt.toISOString(),
            resolvedAt: a.resolvedAt?.toISOString() ?? null,
          })),
        }
      : {}),
  };
}

/**
 * Dossiers de conformité : chaque alerte (correspondance AML, doublon d'identité, violation de
 * règle, signalement de fraude) est rattachée au dossier OPEN du membre pour son type, créé au
 * besoin. La clôture exige que les alertes sources aient été tranchées dans leur circuit.
 */
@Injectable()
export class ComplianceCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
    @Inject(ACCOUNT_DIRECTORY) private readonly accounts: AccountDirectoryPort,
  ) {}

  /** Idempotent : une alerte déjà rattachée (même type, même source) est ignorée. */
  async attachAlert(input: AlertInput): Promise<'attached' | 'ignored'> {
    try {
      return await this.attachOnce(input);
    } catch (e) {
      // Course entre deux consommateurs sur l'index « un dossier ouvert par membre et type ».
      if (isUniqueViolation(e)) return this.attachOnce(input);
      throw e;
    }
  }

  private attachOnce(input: AlertInput): Promise<'attached' | 'ignored'> {
    return this.uow.run(
      async (tx) => {
        const known = await tx.complianceCaseAlert.findUnique({
          where: { alertType_sourceId: { alertType: input.alertType, sourceId: input.sourceId } },
        });
        if (known) return 'ignored';

        let c = await tx.complianceCase.findFirst({
          where: { memberId: input.memberId, type: input.caseType, status: 'OPEN' },
        });
        const created = !c;
        if (!c) {
          c = await tx.complianceCase.create({
            data: {
              memberId: input.memberId,
              type: input.caseType,
              severity: input.severity,
              openedAt: this.clock.now(),
            },
          });
        }
        await tx.complianceCaseAlert.create({
          data: {
            caseId: c.id,
            alertType: input.alertType,
            sourceId: input.sourceId,
            summary: input.summary as object,
            open: input.open,
            createdAt: this.clock.now(),
          },
        });

        let severity = maxSeverity(c.severity, input.severity);
        if (input.caseType === 'RULE_VIOLATION') {
          const count = await tx.complianceCaseAlert.count({ where: { caseId: c.id } });
          severity = maxSeverity(severity, violationSeverity(count));
        }
        if (!created) {
          await tx.complianceCase.update({
            where: { id: c.id },
            data: { severity, version: { increment: 1 } },
          });
        } else {
          if (severity !== c.severity)
            await tx.complianceCase.update({ where: { id: c.id }, data: { severity } });
          await this.outbox.add(tx, {
            type: 'compliance.case.opened',
            aggregateType: 'compliance_case',
            aggregateId: c.id,
            payload: { caseId: c.id, memberId: input.memberId, type: input.caseType, severity },
          });
        }
        return 'attached';
      },
      { isolationLevel: 'Serializable' },
    );
  }

  /** L'alerte source a été tranchée dans son circuit (revue AML, résolution de doublon). */
  async resolveAlert(alertType: ComplianceAlertType, sourceId: string): Promise<void> {
    await this.prisma.complianceCaseAlert.updateMany({
      where: { alertType, sourceId, open: true },
      data: { open: false, resolvedAt: this.clock.now() },
    });
  }

  async list(actor: Actor, q: ComplianceCasesQuery) {
    const cursor = decodeCursor(q.cursor);
    const at = cursor && typeof cursor.k === 'string' ? new Date(cursor.k) : null;
    const desc = q.sort === 'opened_desc';
    const op = desc ? 'lt' : 'gt';
    const after =
      cursor && at && !Number.isNaN(at.getTime()) && UUID.test(cursor.id)
        ? {
            OR: [{ openedAt: { [op]: at } }, { openedAt: at, id: { [op]: cursor.id } }],
          }
        : {};
    const rows = await this.prisma.complianceCase.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.memberId ? { memberId: q.memberId } : {}),
        ...(q.assignee === 'me'
          ? { assigneeId: actor.userId }
          : q.assignee === 'none'
            ? { assigneeId: null }
            : q.assignee
              ? { assigneeId: q.assignee }
              : {}),
        ...after,
      },
      include: { _count: { select: { alerts: true } } },
      orderBy: [{ openedAt: desc ? 'desc' : 'asc' }, { id: desc ? 'desc' : 'asc' }],
      take: q.limit + 1,
    });
    const { items, nextCursor } = buildPage(rows, q.limit, (r) => r.openedAt.toISOString());
    return {
      data: items.map((r) => ({ ...toCaseView(r), alertCount: r._count.alerts })),
      page: { nextCursor, limit: q.limit },
    };
  }

  async get(id: string) {
    const c = await this.find(id);
    return toCaseView(c, c.alerts);
  }

  private async find(id: string): Promise<CaseWithAlerts> {
    const c = await this.prisma.complianceCase.findUnique({
      where: { id },
      include: { alerts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!c) throw new DomainError('NOT_FOUND', 'Dossier introuvable');
    return c;
  }

  /**
   * Assignation (A-49) : dossier ouvert ; agent actif de rôle COMPLIANCE_AGENT ou SUPER_ADMIN.
   * Un agent conformité ne peut que se l'attribuer ou le libérer ; le super-admin répartit.
   */
  async assign(actor: Actor, id: string, assigneeId: string | null) {
    if (actor.role !== 'SUPER_ADMIN') {
      if (assigneeId !== null && assigneeId !== actor.userId)
        throw new DomainError('FORBIDDEN', 'Un agent ne peut s’attribuer que ses propres dossiers');
    }
    if (assigneeId) {
      const account = await this.accounts.account(assigneeId);
      if (
        !account ||
        account.status !== 'ACTIVE' ||
        !(CASE_ASSIGNABLE_ROLES as readonly string[]).includes(account.role)
      )
        throw new DomainError(
          'BUSINESS_RULE_VIOLATION',
          'Le dossier ne peut être assigné qu’à un agent conformité ou un super-admin actif',
        );
    }
    const updated = await this.uow.run(async (tx) => {
      const c = await tx.complianceCase.findUnique({ where: { id } });
      if (!c) throw new DomainError('NOT_FOUND', 'Dossier introuvable');
      if (c.status !== 'OPEN')
        throw new DomainError('INVALID_STATE_TRANSITION', 'Dossier déjà clos');
      if (actor.role !== 'SUPER_ADMIN' && c.assigneeId && c.assigneeId !== actor.userId)
        throw new DomainError('FORBIDDEN', 'Dossier déjà assigné à un autre agent');
      if (c.assigneeId === assigneeId) return c;
      const res = await tx.complianceCase.updateMany({
        where: { id, status: 'OPEN', version: c.version },
        data: {
          assigneeId,
          assignedAt: assigneeId ? this.clock.now() : null,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw new DomainError('VERSION_CONFLICT', 'Dossier modifié entre-temps');
      await this.outbox.add(tx, {
        type: 'compliance.case.assigned',
        aggregateType: 'compliance_case',
        aggregateId: id,
        payload: { caseId: id, memberId: c.memberId, assigneeId, assignedBy: actor.userId },
      });
      await this.audit.record(
        {
          action: assigneeId ? 'compliance.case.assigned' : 'compliance.case.unassigned',
          resourceType: 'compliance_case',
          resourceId: id,
          result: 'SUCCESS',
          metadata: { assigneeId },
        },
        tx,
      );
      return tx.complianceCase.findUniqueOrThrow({ where: { id } });
    });
    return toCaseView(updated);
  }

  async close(actor: Actor, id: string, input: CloseComplianceCaseInput) {
    const closed = await this.uow.run(async (tx) => {
      const c = await tx.complianceCase.findUnique({
        where: { id },
        include: { alerts: { where: { open: true }, select: { alertType: true, sourceId: true } } },
      });
      if (!c) throw new DomainError('NOT_FOUND', 'Dossier introuvable');
      if (c.status === 'CLOSED')
        throw new DomainError('INVALID_STATE_TRANSITION', 'Dossier déjà clos');
      // Seul l'agent assigné (ou le super-admin) clôt un dossier assigné
      if (c.assigneeId && c.assigneeId !== actor.userId && actor.role !== 'SUPER_ADMIN')
        throw new DomainError('FORBIDDEN', 'Dossier assigné à un autre agent');
      if (c.alerts.length > 0)
        throw new DomainError(
          'BUSINESS_RULE_VIOLATION',
          'Des alertes du dossier attendent encore une décision (revue AML ou doublon)',
          { openAlerts: c.alerts },
        );
      const res = await tx.complianceCase.updateMany({
        where: { id, status: 'OPEN', version: c.version },
        data: {
          status: 'CLOSED',
          closedAt: this.clock.now(),
          closedBy: actor.userId,
          outcome: input.outcome,
          closingComment: input.comment,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw new DomainError('VERSION_CONFLICT', 'Dossier modifié entre-temps');
      await this.outbox.add(tx, {
        type: 'compliance.case.closed',
        aggregateType: 'compliance_case',
        aggregateId: id,
        payload: {
          caseId: id,
          memberId: c.memberId,
          type: c.type,
          outcome: input.outcome,
          closedBy: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'compliance.case.closed',
          resourceType: 'compliance_case',
          resourceId: id,
          result: 'SUCCESS',
        },
        tx,
      );
      return tx.complianceCase.findUniqueOrThrow({
        where: { id },
        include: { alerts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
    });
    return toCaseView(closed, closed.alerts);
  }

  /** Score de risque (A-41) : lecture seule, journalisée. */
  async risk(memberId: string) {
    const m = await this.members.snapshot(memberId);
    if (!m) throw new DomainError('NOT_FOUND', 'Membre introuvable');
    const [openCases, recentViolations] = await Promise.all([
      this.prisma.complianceCase.findMany({
        where: { memberId, status: 'OPEN' },
        select: { type: true, severity: true },
      }),
      this.prisma.complianceViolation.count({
        where: { memberId, createdAt: { gte: new Date(this.clock.now().getTime() - 30 * DAY) } },
      }),
    ]);
    const result = riskScore({
      kycLevel: m.kycLevel,
      memberStatus: m.status,
      complianceStatus: m.complianceStatus,
      openCases,
      recentViolations,
    });
    await this.audit.record({
      action: 'compliance.risk.scored',
      resourceType: 'member',
      resourceId: memberId,
      result: 'SUCCESS',
    });
    return { memberId, ...result, computedAt: this.clock.now().toISOString() };
  }
}
