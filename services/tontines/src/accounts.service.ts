import { Injectable } from '@nestjs/common';
import { type TontineAccountInput, moneyView } from '@tontine/contracts';
import { type TontineAccount, isUniqueViolation } from '@tontine/database';
import { type Actor, AuditService, Clock, DomainError, PrismaService } from '@tontine/platform';
import { TontinesService } from './tontines.service';

/**
 * US-10.2 — comptes d'une tontine (principal, solidarité, épargne, prêt). En V1 seul le compte
 * principal est fonctionnel : il est adossé à la cagnotte (wallet TONTINE_POOL) et créé
 * automatiquement ; les autres sont des configurations (règles) sans mouvement de fonds.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly tontines: TontinesService,
  ) {}

  private async view(a: TontineAccount, currency: string) {
    const wallet =
      a.functional && a.walletId
        ? await this.prisma.wallet.findUnique({ where: { id: a.walletId } })
        : null;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      functional: a.functional,
      rules: a.rules,
      balance: wallet ? moneyView(wallet.balanceMinor, currency) : null,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async list(actor: Actor, tontineId: string) {
    const t = await this.tontines.getAdministered(actor, tontineId);
    const rows = await this.prisma.tontineAccount.findMany({
      where: { tontineId },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(rows.map((r) => this.view(r, t.currency)));
  }

  async create(actor: Actor, tontineId: string, input: TontineAccountInput) {
    const t = await this.tontines.getAdministered(actor, tontineId, false);
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED')
      throw new DomainError('INVALID_STATE_TRANSITION', `Tontine ${t.status}`);
    if (input.type === 'MAIN')
      throw new DomainError('CONFLICT', 'Le compte principal existe déjà (créé avec la tontine)');
    try {
      const a = await this.prisma.tontineAccount.create({
        data: {
          tontineId,
          name: input.name,
          type: input.type,
          rules: input.rules as object,
          functional: false,
          createdById: actor.userId,
          createdAt: this.clock.now(),
        },
      });
      await this.audit.record({
        action: 'tontine.account.created',
        resourceType: 'tontine',
        resourceId: tontineId,
        result: 'SUCCESS',
        metadata: { type: a.type },
      });
      return this.view(a, t.currency);
    } catch (e) {
      if (isUniqueViolation(e))
        throw new DomainError('CONFLICT', 'Un compte de ce type existe déjà');
      throw e;
    }
  }
}
