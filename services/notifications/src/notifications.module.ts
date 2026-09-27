import { Module } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { APP_CONFIG, PrismaService } from '@tontine/platform';
import { DeliveryService } from './delivery.service';
import { NotificationConsumers } from './notifications.consumers';
import { DevMessagesController, MyNotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import {
  EmailProvider,
  MemoryEmailProvider,
  SimulatedSmsProvider,
  SmsProvider,
  SmtpEmailProvider,
} from './providers';

/** Domaine Notifications & Communication (épique 8). */
@Module({
  controllers: [MyNotificationsController, DevMessagesController],
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
    NotificationService,
    DeliveryService,
    NotificationConsumers,
  ],
  exports: [NotificationService, DeliveryService, SmsProvider, EmailProvider, SimulatedSmsProvider],
})
export class NotificationsModule {}
