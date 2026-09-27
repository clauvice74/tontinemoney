import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  COMMUNICATION,
  type CommunicationPort,
  OutboxService,
  PrismaService,
  ScheduledJob,
  UnitOfWork,
} from '@tontine/platform';
import { RECIPIENT_DIRECTORY, type RecipientDirectory } from './ports';

export const MAX_DELIVERY_ATTEMPTS = 3;
const BACKOFF_SECONDS = [30, 120, 600];

interface ClaimedNotification {
  id: string;
  recipientId: string;
  channel: 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';
  priority: string;
  title: string;
  body: string;
  attempts: number;
  templateKey: string;
}

/**
 * Acheminement des notifications (US-8.3) : file par priorité, retry ×3 avec backoff,
 * repli sur le canal alternatif, DLQ (statut DEAD), rapports de livraison.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    @Inject(RECIPIENT_DIRECTORY) private readonly directory: RecipientDirectory,
    @Inject(COMMUNICATION) private readonly communication: CommunicationPort,
  ) {}

  @ScheduledJob({
    name: 'notifications.deliver',
    cron: '*/10 * * * * *',
    description: 'Envoi des notifications dues (file prioritaire)',
  })
  async deliverDue(limit = 100): Promise<{ sent: number; failed: number }> {
    const now = this.clock.now();
    const lease = new Date(now.getTime() + 60_000);
    // File prioritaire : URGENT puis HIGH… (R-COM-05)
    const rows = await this.prisma.$queryRaw<ClaimedNotification[]>`
      UPDATE "ntf_notifications" SET "scheduledFor" = ${lease}, "attempts" = "attempts" + 1, "status" = 'PENDING'
      WHERE "id" IN (
        SELECT "id" FROM "ntf_notifications"
        WHERE "status" IN ('PENDING', 'SCHEDULED') AND "scheduledFor" <= ${now}
        ORDER BY CASE "priority" WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, "scheduledFor"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "recipientId", "channel", "priority", "title", "body", "attempts", "templateKey"`;
    let sent = 0;
    let failed = 0;
    for (const n of rows) {
      if (await this.deliverOne(n)) sent++;
      else failed++;
    }
    return { sent, failed };
  }

  private async contactOf(
    recipientId: string,
  ): Promise<{ email: string | null; phone: string | null }> {
    const [m] = await this.directory.getMany([recipientId]);
    return { email: m?.email ?? null, phone: m?.phone ?? null };
  }

  /**
   * Une tentative : IN_APP est disponible immédiatement ; les autres canaux passent par
   * communication-service (comment envoyer). Ici : quoi et quand (réessai avec backoff, DLQ,
   * repli de canal, report anti-spam).
   */
  private async deliverOne(n: ClaimedNotification): Promise<boolean> {
    const result =
      n.channel === 'IN_APP'
        ? ({ status: 'SENT', providerRef: null } as const)
        : await this.communication.send({
            notificationId: n.id,
            recipientId: n.recipientId,
            channel: n.channel,
            priority: n.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
            subject: n.title,
            body: n.body,
          });
    if (result.status === 'SENT') {
      await this.uow.run(async (tx) => {
        await tx.notification.update({
          where: { id: n.id },
          data: { status: 'SENT', sentAt: this.clock.now(), lastError: null },
        });
        await this.outbox.add(tx, {
          type: 'notification.sent',
          aggregateType: 'notification',
          aggregateId: n.id,
          payload: { notificationId: n.id, channel: n.channel, attempts: n.attempts },
        });
      });
      return true;
    }
    if (result.status === 'THROTTLED') {
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'SKIPPED', lastError: result.reason },
      });
      return false;
    }
    const dead = !result.retryable || n.attempts >= MAX_DELIVERY_ATTEMPTS;
    const contact = dead ? await this.contactOf(n.recipientId) : null;
    await this.uow.run(async (tx) => {
      await tx.notification.update({
        where: { id: n.id },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          lastError: result.reason,
          scheduledFor: new Date(
            this.clock.now().getTime() + (BACKOFF_SECONDS[n.attempts - 1] ?? 600) * 1000,
          ),
        },
      });
      await this.outbox.add(tx, {
        type: 'notification.failed',
        aggregateType: 'notification',
        aggregateId: n.id,
        payload: { notificationId: n.id, channel: n.channel, attempts: n.attempts, dead },
      });
      if (dead && contact) await this.fallback(tx, n, contact);
    });
    if (dead) this.logger.warn(`Notification ${n.id} (${n.channel}) en DLQ : ${result.reason}`);
    return false;
  }

  /** Repli sur le canal alternatif après échec définitif (SMS ⇄ EMAIL). */
  private async fallback(
    tx: Parameters<Parameters<UnitOfWork['run']>[0]>[0],
    n: ClaimedNotification,
    contact: { email: string | null; phone: string | null },
  ): Promise<void> {
    const alt =
      n.channel === 'SMS' && contact.email
        ? 'EMAIL'
        : n.channel === 'EMAIL' && contact.phone
          ? 'SMS'
          : null;
    if (!alt) return;
    const original = await tx.notification.findUniqueOrThrow({ where: { id: n.id } });
    const dedupeKey = `fallback:${n.id}`;
    if (await tx.notification.findUnique({ where: { dedupeKey } })) return;
    await tx.notification.create({
      data: {
        recipientId: original.recipientId,
        category: original.category,
        templateKey: original.templateKey,
        eventId: original.eventId,
        eventType: original.eventType,
        priority: original.priority,
        channel: alt,
        status: 'PENDING',
        title: original.title,
        body: alt === 'SMS' ? original.body.slice(0, 160) : original.body,
        dedupeKey,
        scheduledFor: this.clock.now(),
      },
    });
  }
}
