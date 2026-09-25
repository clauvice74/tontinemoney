import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { WalletsConsumers } from './wallets.consumers';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

/** Domaine Portefeuille électronique et grand livre (épique 5). */
@Module({
  controllers: [WalletsController],
  providers: [LedgerService, WalletsService, WalletsConsumers],
  exports: [LedgerService, WalletsService],
})
export class WalletsModule {}
