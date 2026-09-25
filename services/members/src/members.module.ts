import { Global, Module } from '@nestjs/common';
import { NotificationsModule, RECIPIENT_DIRECTORY } from '@tontine/notifications';
import { MEMBER_QUERY } from '@tontine/platform';
import { MemberDirectoryQuery } from './member-directory.query';
import { MemberQueryService } from './member-query';
import { MembersConsumers } from './members.consumers';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { ProfilePhotoStore } from './profile-photo.store';
import { MemberRecipientDirectory } from './recipient-directory';

/** Ports globaux du domaine Membres : RecipientDirectory (Notifications) et MemberQueryPort. */
@Global()
@Module({
  providers: [
    MemberRecipientDirectory,
    MemberQueryService,
    { provide: RECIPIENT_DIRECTORY, useExisting: MemberRecipientDirectory },
    { provide: MEMBER_QUERY, useExisting: MemberQueryService },
  ],
  exports: [RECIPIENT_DIRECTORY, MEMBER_QUERY],
})
export class MembersPortsModule {}

/** Domaine Gestion des membres (épique 2). */
@Module({
  imports: [NotificationsModule],
  controllers: [MembersController],
  providers: [MembersService, MembersConsumers, MemberDirectoryQuery, ProfilePhotoStore],
  exports: [MembersService],
})
export class MembersModule {}
