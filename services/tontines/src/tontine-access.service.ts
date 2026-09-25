import { Injectable } from '@nestjs/common';
import { sha256Hex } from '@tontine/auth';
import { Clock, PrismaService, type TontineAccessPort } from '@tontine/platform';

const LIVE_MEMBERSHIP = ['ACTIVE', 'SUSPENDED'] as const;

/** Implémentation du port TontineAccessPort (lecture seule, contrôles de propriété). */
@Injectable()
export class TontineAccessService implements TontineAccessPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async describe(tontineId: string) {
    const t = await this.prisma.tontine.findUnique({
      where: { id: tontineId },
      select: { id: true, name: true, currency: true, status: true },
    });
    return t ? { ...t, status: t.status as string } : null;
  }

  async adminIds(tontineId: string): Promise<string[]> {
    const rows = await this.prisma.tontineMember.findMany({
      where: { tontineId, role: 'ADMIN', status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] } },
      select: { memberId: true },
    });
    return rows.map((r) => r.memberId);
  }

  async participantIds(tontineId: string): Promise<string[]> {
    const rows = await this.prisma.tontineMember.findMany({
      where: { tontineId, status: { in: [...LIVE_MEMBERSHIP] } },
      select: { memberId: true },
    });
    return rows.map((r) => r.memberId);
  }

  async isAdmin(tontineId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.tontineMember.findUnique({
      where: { tontineId_memberId: { tontineId, memberId: userId } },
      select: { role: true, status: true },
    });
    return (
      !!m && m.role === 'ADMIN' && (m.status === 'ACTIVE' || m.status === 'PENDING_ACTIVATION')
    );
  }

  async isParticipant(tontineId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.tontineMember.findUnique({
      where: { tontineId_memberId: { tontineId, memberId: userId } },
      select: { status: true },
    });
    return !!m && (LIVE_MEMBERSHIP as readonly string[]).includes(m.status);
  }

  async tontineIdsOf(userId: string): Promise<string[]> {
    const rows = await this.prisma.tontineMember.findMany({
      where: { memberId: userId, status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION'] } },
      select: { tontineId: true },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => r.tontineId);
  }

  async shareTontine(userA: string, userB: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "ton_members" a JOIN "ton_members" b ON a."tontineId" = b."tontineId"
      WHERE a."memberId" = ${userA}::uuid AND b."memberId" = ${userB}::uuid
        AND a."status" IN ('ACTIVE', 'SUSPENDED') AND b."status" IN ('ACTIVE', 'SUSPENDED')`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async resolveInvitationCode(code: string): Promise<string | null> {
    const inv = await this.prisma.tontineInvitation.findUnique({
      where: { codeHash: sha256Hex(code.trim()) },
      select: {
        tontineId: true,
        status: true,
        expiresAt: true,
        tontine: { select: { status: true } },
      },
    });
    if (inv) {
      const open =
        inv.status === 'PENDING' &&
        inv.expiresAt > this.clock.now() &&
        ['DRAFT', 'READY'].includes(inv.tontine.status);
      return open ? inv.tontineId : null;
    }
    const t = await this.prisma.tontine.findFirst({
      where: {
        invitationLinkHash: sha256Hex(code.trim()),
        status: { in: ['DRAFT', 'READY'] },
        invitationLinkExpires: { gt: this.clock.now() },
      },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  async findByExactName(name: string): Promise<string | null> {
    const rows = await this.prisma.tontine.findMany({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        status: { in: ['DRAFT', 'READY', 'ACTIVE'] },
      },
      select: { id: true },
      take: 2,
    });
    return rows.length === 1 ? rows[0]!.id : null;
  }
}
