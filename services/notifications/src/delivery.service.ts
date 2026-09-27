import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, OutboxService, PrismaService, ScheduledJob, UnitOfWork } from '@tontine/platform';
import { RECIPIENT_DIRECTORY, type RecipientDirectory } from './ports';
import { EmailProvider, ProviderError, SmsProvider } from './providers';
import { emailHtml } from './render';

export const MAX_DELIVERY_ATTEMPTS = 3;
/** R-COM-03 : 10 SMS / jour / utilisateur hors urgences. */
export const SMS_DAILY_LIMIT = 10;
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
    private readonly sms: SmsProvider,
    private readonly email: EmailProvider,
    @Inject(RECIPIENT_DIRECTORY) private readonly directory: RecipientDirectory,
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

  private async deliverOne(n: ClaimedNotification): Promise<boolean> {
    const contact = await this.contactOf(n.recipientId);
    try {
      if (n.channel === 'SMS') {
        if (!contact.phone) throw new ProviderError('Aucun numéro', false);
        if (
          n.priority !== 'URGENT' &&
          (await this.smsSentToday(n.recipientId)) >= SMS_DAILY_LIMIT
        ) {
          await this.prisma.notification.update({
            where: { id: n.id },
            data: {
              status: 'SKIPPED',
              lastError: 'Limite anti-spam de 10 SMS/jour atteinte (R-COM-03)',
            },
          });
          return false;
        }
        await this.sms.send(contact.phone, n.body, n.id);
      } else if (n.channel === 'EMAIL') {
        if (!contact.email) throw new ProviderError('Aucun email', false);
        await this.email.send(contact.email, n.title, n.body, emailHtml(n.title, n.body), n.id);
      }
      // PUSH : simulé (aucune application mobile en V1) ; IN_APP : déjà disponible.
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
    } catch (e) {
      const retryable = !(e instanceof ProviderError) || e.retryable;
      const dead = !retryable || n.attempts >= MAX_DELIVERY_ATTEMPTS;
      const reason = e instanceof Error ? e.message : String(e);
      await this.uow.run(async (tx) => {
        await tx.notification.update({
          where: { id: n.id },
          data: {
            status: dead ? 'DEAD' : 'PENDING',
            lastError: reason,
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
        if (dead) await this.fallback(tx, n, contact);
      });
      if (dead) this.logger.warn(`Notification ${n.id} (${n.channel}) en DLQ : ${reason}`);
      return false;
    }
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

  private async smsSentToday(recipientId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        recipientId,
        channel: 'SMS',
        status: 'SENT',
        priority: { not: 'URGENT' },
        sentAt: { gte: new Date(this.clock.now().getTime() - 86_400_000) },
      },
    });
  }
}
