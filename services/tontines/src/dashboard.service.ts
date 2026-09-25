import { Inject, Injectable } from '@nestjs/common';
import { type TargetedMessageInput, moneyView } from '@tontine/contracts';
import { NotificationService } from '@tontine/notifications';
import {
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
import { contributionView } from './contributions.service';
import { TontinesService } from './tontines.service';

const PAID = ['PAID', 'PAID_LATE'];
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Tableau de bord de la tontine (US-4.10) et messagerie ciblée (US-10.3). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly tontines: TontinesService,
    private readonly notifications: NotificationService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  /** Vue admin (agrégats, retards) ou vue membre (ses contributions, ses tours, ses pénalités). */
  async dashboard(actor: Actor, tontineId: string) {
    const { tontine: t, membership } = await this.tontines.getVisible(actor, tontineId);
    const isAdmin = membership?.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
    const cycles = await this.prisma.tontineCycle.findMany({
      where: { tontineId },
      orderBy: { number: 'asc' },
      include: { contributions: true },
    });
    const names = new Map(
      (
        await this.members.snapshots([
          ...new Set(
            cycles.flatMap((c) => [
              ...(c.beneficiaryId ? [c.beneficiaryId] : []),
              ...c.contributions.map((x) => x.memberId),
            ]),
          ),
        ])
      ).map((s) => [s.id, s]),
    );
    const fullName = (id: string) =>
      `${names.get(id)?.firstName ?? ''} ${names.get(id)?.lastName ?? ''}`.trim() || '—';
    const current = cycles.find((c) => c.number === t.currentCycleNumber) ?? null;
    const generatedAt = this.clock.now().toISOString();

    if (!isAdmin) {
      const mine = cycles.flatMap((c) =>
        c.contributions
          .filter((x) => x.memberId === actor.userId)
          .map((x) => contributionView(x, t, c.number)),
      );
      const penaltyBalance = cycles
        .flatMap((c) => c.contributions)
        .filter((x) => x.memberId === actor.userId && x.penaltyMinor > 0n && !x.penaltyPaid)
        .reduce((s, x) => s + x.penaltyMinor, 0n);
      const position = membership?.position ?? null;
      return {
        role: 'MEMBER',
        generatedAt,
        refreshIntervalSeconds: 30,
        myContributions: mine,
        myBeneficiaryCycles: cycles
          .filter((c) => c.beneficiaryId === actor.userId)
          .map((c) => ({
            number: c.number,
            dueDate: iso(c.dueDate),
            status: c.status,
            payout: c.payoutMinor !== null ? moneyView(c.payoutMinor, t.currency) : null,
          })),
        myPosition: position,
        myUpcomingTurn:
          position && t.drawMode !== 'PRIORITY_NEED' && (t.currentCycleNumber ?? 0) <= position
            ? { number: position }
            : null,
        myPenaltyBalance: moneyView(penaltyBalance, t.currency),
        currentCycle: current
          ? {
              number: current.number,
              dueDate: iso(current.dueDate),
              beneficiary: current.beneficiaryId
                ? {
                    memberId: current.beneficiaryId,
                    firstName: names.get(current.beneficiaryId)?.firstName ?? '—',
                  }
                : null,
            }
          : null,
      };
    }

    const allContribs = cycles.flatMap((c) => c.contributions);
    const totalCollected = allContribs
      .filter((x) => PAID.includes(x.status))
      .reduce((s, x) => s + x.amountMinor, 0n);
    const penaltiesCollected = allContribs
      .filter((x) => x.penaltyPaid)
      .reduce((s, x) => s + x.penaltyMinor, 0n);
    const penaltiesDue = allContribs
      .filter((x) => x.penaltyMinor > 0n && !x.penaltyPaid)
      .reduce((s, x) => s + x.penaltyMinor, 0n);
    const lateMembers = allContribs
      .filter((x) => x.status === 'LATE' || x.status === 'DEFAULTED')
      .map((x) => ({
        memberId: x.memberId,
        fullName: fullName(x.memberId),
        status: x.status,
        daysLate: Math.max(
          0,
          Math.floor((this.clock.now().getTime() - x.graceUntil.getTime()) / 86_400_000),
        ),
        penalty: moneyView(x.penaltyMinor, t.currency),
      }));
    const reserve = t.reserveWalletId
      ? await this.prisma.wallet.findUnique({ where: { id: t.reserveWalletId } })
      : null;
    return {
      role: 'ADMIN',
      generatedAt,
      refreshIntervalSeconds: 30,
      status: t.status,
      totalCollected: moneyView(totalCollected, t.currency),
      penaltiesCollected: moneyView(penaltiesCollected, t.currency),
      penaltiesDue: moneyView(penaltiesDue, t.currency),
      reserveBalance: moneyView(reserve?.balanceMinor ?? 0n, t.currency),
      currentCycle: current
        ? {
            id: current.id,
            number: current.number,
            status: current.status,
            beneficiary: current.beneficiaryId
              ? { memberId: current.beneficiaryId, fullName: fullName(current.beneficiaryId) }
              : null,
            paidCount: current.contributions.filter((x) => PAID.includes(x.status)).length,
            memberCount: current.contributions.length,
            collected: moneyView(current.collectedMinor, t.currency),
            remaining: moneyView(
              current.expectedMinor > current.collectedMinor
                ? current.expectedMinor - current.collectedMinor
                : 0n,
              t.currency,
            ),
            dueDate: iso(current.dueDate),
          }
        : null,
      cycles: cycles.map((c) => ({
        id: c.id,
        number: c.number,
        status: c.status,
        dueDate: iso(c.dueDate),
        beneficiary: c.beneficiaryId
          ? { memberId: c.beneficiaryId, fullName: fullName(c.beneficiaryId) }
          : null,
        collected: moneyView(c.collectedMinor, t.currency),
        payout: c.payoutMinor !== null ? moneyView(c.payoutMinor, t.currency) : null,
        partialPayout: c.partialPayout,
        completedAt: c.completedAt?.toISOString() ?? null,
      })),
      lateMembers,
    };
  }

  // ------------------------------------------------------------------ US-10.3 messagerie ciblée
  async sendMessage(actor: Actor, tontineId: string, input: TargetedMessageInput) {
    const t = await this.tontines.getAdministered(actor, tontineId, false);
    let rows = await this.prisma.tontineMember.findMany({
      where: { tontineId, status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION'] } },
    });
    const f = input.filter;
    if (f.memberIds?.length) rows = rows.filter((r) => f.memberIds!.includes(r.memberId));
    let ids = rows.map((r) => r.memberId).filter((id) => id !== actor.userId);
    if (f.memberStatuses?.length) {
      const snaps = await this.members.snapshots(ids);
      ids = snaps.filter((s) => f.memberStatuses!.includes(s.status as never)).map((s) => s.id);
    }
    if (f.contributionStatus && t.currentCycleNumber) {
      const cycle = await this.prisma.tontineCycle.findUnique({
        where: { tontineId_number: { tontineId, number: t.currentCycleNumber } },
        include: { contributions: true },
      });
      const wanted =
        f.contributionStatus === 'LATE'
          ? ['LATE', 'DEFAULTED']
          : f.contributionStatus === 'PAID'
            ? PAID
            : ['PENDING'];
      const matching = new Set(
        cycle?.contributions.filter((c) => wanted.includes(c.status)).map((c) => c.memberId) ?? [],
      );
      ids = ids.filter((id) => matching.has(id));
    }
    if (ids.length === 0)
      throw new DomainError('VALIDATION_FAILED', 'Aucun destinataire ne correspond au filtre');
    const msg = await this.uow.run(async (tx) => {
      const m = await tx.adminMessage.create({
        data: {
          tontineId,
          senderId: actor.userId,
          template: input.template,
          subject: input.subject,
          body: input.body,
          filter: f as object,
          recipientCount: ids.length,
          createdAt: this.clock.now(),
        },
      });
      await this.notifications.notify(
        {
          recipientIds: ids,
          template: 'admin.message',
          vars: { sujet: `[${t.name}] ${input.subject}`, message: input.body },
          dedupeKey: `admin-message:${m.id}`,
          priority: input.template === 'REMINDER' ? 'HIGH' : 'MEDIUM',
          data: { tontineId, messageId: m.id },
        },
        tx,
      );
      await this.outbox.add(tx, {
        type: 'admin.message.sent',
        aggregateType: 'tontine',
        aggregateId: tontineId,
        payload: { messageId: m.id, tontineId, recipientCount: ids.length },
      });
      await this.audit.record(
        {
          action: 'tontine.message.sent',
          resourceType: 'tontine',
          resourceId: tontineId,
          result: 'SUCCESS',
          metadata: { messageId: m.id, recipientCount: ids.length, template: input.template },
        },
        tx,
      );
      return m;
    });
    return {
      id: msg.id,
      template: msg.template,
      subject: msg.subject,
      body: msg.body,
      recipientCount: msg.recipientCount,
      createdAt: msg.createdAt.toISOString(),
    };
  }

  async messages(actor: Actor, tontineId: string) {
    await this.tontines.getAdministered(actor, tontineId);
    const rows = await this.prisma.adminMessage.findMany({
      where: { tontineId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((m) => ({
      id: m.id,
      template: m.template,
      subject: m.subject,
      body: m.body,
      filter: m.filter,
      recipientCount: m.recipientCount,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}
