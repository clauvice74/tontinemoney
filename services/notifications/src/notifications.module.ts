import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { NotificationConsumers } from './notifications.consumers';
import { MyNotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';

/** Domaine Notifications (épique 8) : quoi envoyer, à qui, quand ; le transport relève de communication (A-51). */
@Module({
  controllers: [MyNotificationsController],
  providers: [NotificationService, DeliveryService, NotificationConsumers],
  exports: [NotificationService, DeliveryService],
})
export class NotificationsModule {}
