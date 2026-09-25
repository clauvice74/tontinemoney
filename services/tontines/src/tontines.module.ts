import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '@tontine/notifications';
import { TONTINE_ACCESS } from '@tontine/platform';
import { TransactionsModule } from '@tontine/transactions';
import { InvitationsService } from './invitations.service';
import { MembershipConsumers } from './membership.consumers';
import { TontineAccessService } from './tontine-access.service';
import { TontinesConsumers } from './tontines.consumers';
import { TontinesController } from './tontines.controller';
import { TontinesService } from './tontines.service';

/** Port global d'accès aux tontines (consommé par Auth, Membres, Notifications…). */
@Global()
@Module({
  providers: [TontineAccessService, { provide: TONTINE_ACCESS, useExisting: TontineAccessService }],
  exports: [TONTINE_ACCESS, TontineAccessService],
})
export class TontinesPortsModule {}

/** Domaine Gestion des tontines rotatives (épique 4). */
@Module({
  imports: [TransactionsModule, NotificationsModule],
  controllers: [TontinesController],
  providers: [MembershipConsumers, TontinesConsumers, TontinesService, InvitationsService],
  exports: [TontinesService, InvitationsService],
})
export class TontinesModule {}
