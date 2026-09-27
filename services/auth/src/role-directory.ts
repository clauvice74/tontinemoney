import { Injectable } from '@nestjs/common';
import { type PlatformRole } from '@tontine/contracts';
import { type RoleDirectory } from '@tontine/notifications';
import { PrismaService } from '@tontine/platform';

/** Implémentation du port RoleDirectory (destinataires par rôle plateforme). */
@Injectable()
export class UserRoleDirectory implements RoleDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async userIdsWithRole(role: PlatformRole): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { role, status: 'ACTIVE' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
