import { Global, Module } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { APP_CONFIG, COMMUNICATION, PrismaService } from '@tontine/platform';
import { CommunicationService } from './communication.service';
import { DevMessagesController } from './dev-messages.controller';
import {
  EmailProvider,
  MemoryEmailProvider,
  SimulatedSmsProvider,
  SmsProvider,
  SmtpEmailProvider,
} from './providers';

/**
 * Communication (A-51) : transport des messages (SMS simulé, SMTP, push simulé), journal de
 * livraison, console des messages simulés. Fournit globalement le port COMMUNICATION.
 */
@Global()
@Module({
  controllers: [DevMessagesController],
  providers: [
    SimulatedSmsProvider,
    { provide: SmsProvider, useExisting: SimulatedSmsProvider },
    {
      provide: EmailProvider,
      inject: [APP_CONFIG, PrismaService],
      useFactory: (config: AppConfig, prisma: PrismaService) =>
        config.EMAIL_DRIVER === 'memory'
          ? new MemoryEmailProvider(prisma)
          : new SmtpEmailProvider(config, prisma),
    },
    CommunicationService,
    { provide: COMMUNICATION, useExisting: CommunicationService },
  ],
  exports: [COMMUNICATION, SmsProvider, EmailProvider, SimulatedSmsProvider],
})
export class CommunicationModule {}
