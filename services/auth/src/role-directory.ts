import { Injectable } from '@nestjs/common';
import { type PlatformRole } from '@tontine/contracts';
import { type RoleDirectory } from '@tontine/notifications';
import { type AccountDirectoryPort, type AccountSnapshot, PrismaService } from '@tontine/platform';

/** Implémentation des ports RoleDirectory (destinataires par rôle) et AccountDirectoryPort. */
@Injectable()
export class UserRoleDirectory implements RoleDirectory, AccountDirectoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async userIdsWithRole(role: PlatformRole): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { role, status: 'ACTIVE' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async account(userId: string): Promise<AccountSnapshot | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
  }

  async statistics(): Promise<{ byStatus: Record<string, number>; pendingAccessRequests: number }> {
    const [groups, pendingAccessRequests] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.accessRequest.count({ where: { status: 'PENDING' } }),
    ]);
    return {
      byStatus: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
      pendingAccessRequests,
    };
  }
}
