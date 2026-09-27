import { Injectable } from '@nestjs/common';
import { type TxClient } from '@tontine/database';
import { type AdminDelegationPort, PrismaService } from '@tontine/platform';

/** Port de délégation de création de tontine (A-04) — seul Auth écrit la table des utilisateurs. */
@Injectable()
export class AdminDelegationService implements AdminDelegationPort {
  constructor(private readonly prisma: PrismaService) {}

  async pendingDelegation(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, delegatedTontineName: true, delegatedTontineUsed: true },
    });
    if (!u || u.role !== 'TONTINE_ADMIN' || u.delegatedTontineUsed) return null;
    return u.delegatedTontineName ?? null;
  }

  async consumeDelegation(tx: TxClient, userId: string): Promise<boolean> {
    const res = await tx.user.updateMany({
      where: {
        id: userId,
        role: 'TONTINE_ADMIN',
        delegatedTontineUsed: false,
        delegatedTontineName: { not: null },
      },
      data: { delegatedTontineUsed: true },
    });
    return res.count === 1;
  }
}
