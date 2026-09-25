import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent, OutboxService, PrismaService, UnitOfWork } from '@tontine/platform';

/**
 * Adhésions créées par les flux d'inscription (US-1.2 §10, US-2.4) :
 * pré-association en attente d'activation, puis activation avec le compte.
 */
@Injectable()
export class MembershipConsumers {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  @OnEvent('user.registered', { consumer: 'tontines.pre-association' })
  async onRegistered(e: EventEnvelope<'user.registered'>): Promise<void> {
    const { tontineId, userId, registeredBy } = e.payload;
    if (!tontineId) return;
    await this.prisma.tontineMember.upsert({
      where: { tontineId_memberId: { tontineId, memberId: userId } },
      create: {
        tontineId,
        memberId: userId,
        role: 'MEMBER',
        status: 'PENDING_ACTIVATION',
        registeredById: registeredBy,
      },
      update: {},
    });
  }

  @OnEvent('member.decision', { consumer: 'tontines.access-approved' })
  async onDecision(e: EventEnvelope<'member.decision'>): Promise<void> {
    const { tontineId, memberId, decision, reason, decidedBy } = e.payload;
    await this.prisma.tontineMember.upsert({
      where: { tontineId_memberId: { tontineId, memberId } },
      create: {
        tontineId,
        memberId,
        role: 'MEMBER',
        status: decision === 'ACCEPTED' ? 'PENDING_ACTIVATION' : 'REJECTED',
        decidedById: decidedBy,
        decisionReason: reason,
        decidedAt: new Date(),
      },
      update: {
        status: decision === 'ACCEPTED' ? 'PENDING_ACTIVATION' : 'REJECTED',
        decidedById: decidedBy,
        decisionReason: reason,
        decidedAt: new Date(),
      },
    });
  }

  @OnEvent('user.activated', { consumer: 'tontines.membership-activation' })
  async onActivated(e: EventEnvelope<'user.activated'>): Promise<void> {
    const pending = await this.prisma.tontineMember.findMany({
      where: { memberId: e.payload.userId, status: 'PENDING_ACTIVATION' },
    });
    for (const m of pending) {
      await this.uow.run(async (tx) => {
        const res = await tx.tontineMember.updateMany({
          where: { id: m.id, status: 'PENDING_ACTIVATION' },
          data: { status: 'ACTIVE', joinedAt: new Date() },
        });
        if (res.count !== 1) return;
        await this.outbox.add(tx, {
          type: 'tontine.member.added',
          aggregateType: 'tontine',
          aggregateId: m.tontineId,
          payload: { tontineId: m.tontineId, memberId: m.memberId, position: m.position },
        });
      });
    }
  }
}
