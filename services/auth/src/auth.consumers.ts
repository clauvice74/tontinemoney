import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent, PrismaService } from '@tontine/platform';
import { TokenService } from './token.service';

/** Consommateurs du domaine Auth (P2 §1.6). */
@Injectable()
export class AuthConsumers {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** Suspension (fraude, conformité, admin) : accès coupé et déconnexion forcée. */
  @OnEvent('member.suspended', { consumer: 'auth.member-suspended' })
  async onSuspended(e: EventEnvelope<'member.suspended'>): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: e.payload.memberId } });
    if (!user) return;
    if (user.status === 'ACTIVE')
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await this.tokens.revokeAll(user.id, 'SUSPENDED');
  }

  @OnEvent('member.reactivated', { consumer: 'auth.member-reactivated' })
  async onReactivated(e: EventEnvelope<'member.reactivated'>): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: e.payload.memberId, status: 'SUSPENDED' },
      data: { status: 'ACTIVE' },
    });
  }

  /** Synchronise les identifiants de connexion modifiés dans le profil (US-2.2). */
  @OnEvent('member.updated', { consumer: 'auth.identifiers-sync' })
  async onMemberUpdated(e: EventEnvelope<'member.updated'>): Promise<void> {
    const data: { email?: string; phone?: string; language?: string } = {};
    const nv = e.payload.newValues;
    if (e.payload.changedFields.includes('email') && typeof nv['email'] === 'string')
      data.email = nv['email'];
    if (e.payload.changedFields.includes('phone') && typeof nv['phone'] === 'string')
      data.phone = nv['phone'];
    if (e.payload.changedFields.includes('language') && typeof nv['language'] === 'string')
      data.language = nv['language'];
    if (Object.keys(data).length)
      await this.prisma.user.update({ where: { id: e.payload.memberId }, data });
  }
}
