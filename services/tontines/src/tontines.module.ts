import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '@tontine/notifications';
import { TONTINE_ACCESS } from '@tontine/platform';
import { TransactionsModule } from '@tontine/transactions';
import { AccountsService } from './accounts.service';
import { ContributionsService } from './contributions.service';
import { CyclesController } from './cycles.controller';
import { CyclesService } from './cycles.service';
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
  controllers: [TontinesController, CyclesController],
  providers: [
    MembershipConsumers,
    TontinesConsumers,
    TontinesService,
    InvitationsService,
    CyclesService,
    ContributionsService,
    AccountsService,
  ],
  exports: [TontinesService, InvitationsService, CyclesService, ContributionsService],
})
export class TontinesModule {}
