import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type WalletHistoryQuery,
  walletHistoryQuerySchema,
  walletStatusSchema,
} from '@tontine/contracts';
import { type Wallet } from '@tontine/database';
import {
  AccessDeniedMonitor,
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  AuditService,
  CurrentUser,
  DomainError,
  Roles,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { WalletsService, walletView } from './wallets.service';

@ApiTags('Portefeuille')
@ApiBearerAuth()
@Controller({ version: '1' })
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly denied: AccessDeniedMonitor,
    private readonly audit: AuditService,
  ) {}

  /** US-5.2 — solde total, disponible et bloqué (toujours le wallet du porteur du jeton, US-2.5). */
  @Get('me/wallet')
  @ApiOperation({ summary: 'Mon portefeuille : solde total, disponible, bloqué' })
  async mine(@CurrentUser() actor: Actor) {
    return walletView(await this.wallets.memberWallet(actor.userId));
  }

  @Get('me/wallet/movements')
  @ApiOperation({ summary: 'Historique des mouvements (US-5.2) — filtré par le porteur du jeton' })
  @ApiZodQuery(walletHistoryQuerySchema)
  async history(
    @CurrentUser() actor: Actor,
    @ZodQuery(walletHistoryQuerySchema) q: WalletHistoryQuery,
  ) {
    return this.wallets.history(actor.userId, q);
  }

  @Get('wallets/:walletId')
  @ApiOperation({ summary: 'Portefeuille par identifiant (titulaire ou super-admin)' })
  async one(@CurrentUser() actor: Actor, @Param('walletId', ParseUUIDPipe) walletId: string) {
    return walletView(await this.visible(actor, walletId));
  }

  @Get('wallets/:walletId/balance')
  @ApiOperation({ summary: 'Solde total, disponible et bloqué (titulaire ou super-admin)' })
  async balance(@CurrentUser() actor: Actor, @Param('walletId', ParseUUIDPipe) walletId: string) {
    const { id, currency, balance, available, blocked } = walletView(
      await this.visible(actor, walletId),
    );
    return { id, currency, balance, available, blocked };
  }

  @Get('wallets/:walletId/history')
  @ApiOperation({ summary: 'Mouvements d’un portefeuille (titulaire ou super-admin)' })
  @ApiZodQuery(walletHistoryQuerySchema)
  async walletHistory(
    @CurrentUser() actor: Actor,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @ZodQuery(walletHistoryQuerySchema) q: WalletHistoryQuery,
  ) {
    return this.wallets.historyOf(await this.visible(actor, walletId), q);
  }

  /**
   * Le titulaire voit son portefeuille ; le super-admin voit tout portefeuille (lecture
   * journalisée). Pour tout autre, 404 sans révéler l'existence du portefeuille (US-2.5).
   */
  private async visible(actor: Actor, walletId: string): Promise<Wallet> {
    const w = await this.wallets.get(walletId).catch(() => null);
    if (w && w.memberId === actor.userId) return w;
    if (w && actor.role === 'SUPER_ADMIN') {
      await this.audit.record({
        action: 'wallet.read_by_staff',
        resourceType: 'wallet',
        resourceId: walletId,
        result: 'SUCCESS',
      });
      return w;
    }
    await this.denied.record('wallet', walletId, w ? 'not-owner' : 'not-found');
    throw new DomainError('NOT_FOUND', 'Portefeuille introuvable');
  }

  @Post('admin/wallets/:walletId/status')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Changer le statut d’un portefeuille (super-admin)' })
  @ApiZodBody(walletStatusSchema)
  async setStatus(
    @CurrentUser() actor: Actor,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @ZodBody(walletStatusSchema)
    body: { status: 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'CLOSED'; reason: string },
  ) {
    return walletView(
      await this.wallets.setStatus(walletId, body.status, body.reason, `admin:${actor.userId}`),
    );
  }
}
