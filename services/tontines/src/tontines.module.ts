import { Global, Module } from '@nestjs/common';
import { TONTINE_ACCESS } from '@tontine/platform';
import { MembershipConsumers } from './membership.consumers';
import { TontineAccessService } from './tontine-access.service';

/** Port global d'accès aux tontines (consommé par Auth, Membres, Notifications…). */
@Global()
@Module({
  providers: [TontineAccessService, { provide: TONTINE_ACCESS, useExisting: TontineAccessService }],
  exports: [TONTINE_ACCESS, TontineAccessService],
})
export class TontinesPortsModule {}

/** Domaine Gestion des tontines rotatives (épique 4). */
@Module({
  providers: [MembershipConsumers],
})
export class TontinesModule {}
