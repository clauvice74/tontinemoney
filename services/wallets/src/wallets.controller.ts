import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type WalletHistoryQuery,
  walletHistoryQuerySchema,
  walletStatusSchema,
} from '@tontine/contracts';
import {
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  CurrentUser,
  Roles,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { WalletsService, walletView } from './wallets.service';

@ApiTags('Portefeuille')
@ApiBearerAuth()
@Controller({ version: '1' })
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

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
