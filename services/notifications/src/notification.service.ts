import { Inject, Injectable, Logger } from '@nestjs/common';
import { type NotificationChannel, type NotificationPriority } from '@tontine/contracts';
import { type DbClient, type TxClient } from '@tontine/database';
import { AuditService, Clock, OutboxService, PrismaService, UnitOfWork } from '@tontine/platform';
import { type RecipientDirectory, type RecipientProfile, RECIPIENT_DIRECTORY } from './ports';
import { nextAllowedTime } from './quiet-hours';
import { type TemplateVars, emailHtml, renderTemplate } from './render';
import { EmailProvider, SmsProvider } from './providers';
import { TEMPLATES, type TemplateKey } from './templates';

export interface NotifyInput {
  recipientIds: string[];
  template: TemplateKey;
  /** Variables communes, ou fonction par destinataire (prénom, langue…). */
  vars: TemplateVars | ((r: RecipientProfile) => TemplateVars);
  eventId?: string | null;
  eventType?: string | null;
  /** Clé de déduplication (préfixée par destinataire et canal). */
  dedupeKey?: string;
  scheduledFor?: Date;
  /** Force une priorité (ex. rappel du jour J). */
  priority?: NotificationPriority;
  /** Restreint / remplace les canaux par défaut du modèle. */
  channels?: NotificationChannel[];
  data?: Record<string, unknown>;
}

export interface DirectInput {
  to: { email?: string | null; phone?: string | null };
  userId?: string | null;
  template: TemplateKey;
  vars: TemplateVars;
  language?: string | null;
  country?: string | null;
  channels: NotificationChannel[];
}

export interface DirectResult {
  delivered: NotificationChannel[];
  failed: NotificationChannel[];
}

/** Catégories jamais désactivables par le membre (R-NOT-04). */
const MANDATORY_CATEGORIES = new Set(['SECURITY']);

/**
 * Génération, personnalisation et planification des notifications (US-8.1, US-8.2, US-8.5).
 * L'envoi effectif est assuré par DeliveryService (file + retry + DLQ, US-8.3).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly sms: SmsProvider,
    private readonly email: EmailProvider,
    private readonly audit: AuditService,
    @Inject(RECIPIENT_DIRECTORY) private readonly directory: RecipientDirectory,
  ) {}

  /** Choix des canaux : modèle par défaut, préférence du membre, contacts disponibles. */
  resolveChannels(
    template: TemplateKey,
    recipient: RecipientProfile,
    priority: NotificationPriority,
    override?: NotificationChannel[],
  ): NotificationChannel[] {
    const base = override ?? [...TEMPLATES[template].channels];
    let channels = [...base];
    const pref = recipient.preferredChannel;
    if (priority !== 'URGENT' && (pref === 'EMAIL' || pref === 'SMS')) {
      const other = pref === 'EMAIL' ? 'SMS' : 'EMAIL';
      if (channels.includes(other) && !channels.includes(pref)) {
        channels = channels.map((c) => (c === other ? pref : c));
      }
    }
    channels = channels.filter(
      (c) => (c !== 'SMS' || !!recipient.phone) && (c !== 'EMAIL' || !!recipient.email),
    );
    if (!channels.includes('IN_APP')) channels.push('IN_APP');
    return [...new Set(channels)];
  }

  async notify(input: NotifyInput, db?: TxClient): Promise<number> {
    if (input.recipientIds.length === 0) return 0;
    const recipients = await this.directory.getMany([...new Set(input.recipientIds)]);
    if (db) return this.createFor(db, recipients, input);
    return this.uow.run((tx) => this.createFor(tx, recipients, input));
  }

  private async createFor(
    tx: TxClient,
    recipients: RecipientProfile[],
    input: NotifyInput,
  ): Promise<number> {
    const tpl = TEMPLATES[input.template];
    const priority = input.priority ?? tpl.priority;
    const now = this.clock.now();
    let created = 0;
    for (const r of recipients) {
      const vars = typeof input.vars === 'function' ? input.vars(r) : input.vars;
      const enabled =
        MANDATORY_CATEGORIES.has(tpl.category) || r.enabledTypes.includes(tpl.category);
      for (const channel of this.resolveChannels(input.template, r, priority, input.channels)) {
        // notify() ne transporte jamais de secret d'authentification (réservé à sendDirect).
        const stored = renderTemplate(input.template, channel, r.language, vars, {
          country: r.country,
        });
        const baseTime = input.scheduledFor ?? now;
        // Les notifications urgentes ignorent les heures calmes (R-NOT-01) ; l'in-app n'est pas intrusif.
        const sendAt =
          priority === 'URGENT' || channel === 'IN_APP'
            ? baseTime
            : nextAllowedTime(baseTime, r.timezone, r.quietHours);
        const status =
          !enabled && channel !== 'IN_APP'
            ? 'SKIPPED'
            : channel === 'IN_APP'
              ? 'SENT'
              : sendAt > now
                ? 'SCHEDULED'
                : 'PENDING';
        const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${r.id}:${channel}` : null;
        if (dedupeKey) {
          const exists = await tx.notification.findUnique({
            where: { dedupeKey },
            select: { id: true },
          });
          if (exists) continue;
        }
        const n = await tx.notification.create({
          data: {
            recipientId: r.id,
            category: tpl.category,
            templateKey: input.template,
            eventId: input.eventId ?? null,
            eventType: input.eventType ?? null,
            priority,
            channel,
            status,
            title: stored.title,
            body: stored.body,
            data: (input.data ?? undefined) as object | undefined,
            dedupeKey,
            scheduledFor: sendAt,
            sentAt: status === 'SENT' ? now : null,
            lastError: status === 'SKIPPED' ? 'Type de notification désactivé par le membre' : null,
          },
        });
        created++;
        await this.outbox.add(tx, {
          type: 'notification.created',
          aggregateType: 'notification',
          aggregateId: n.id,
          payload: {
            notificationId: n.id,
            memberId: r.id,
            type: input.template,
            channel,
            priority,
          },
        });
      }
    }
    return created;
  }

  async recipients(ids: string[]): Promise<RecipientProfile[]> {
    return ids.length ? this.directory.getMany([...new Set(ids)]) : [];
  }

  /** Destinataires d'un rôle plateforme résolus par l'appelant. */
  async notifyUsers(
    userIds: string[],
    template: TemplateKey,
    vars: TemplateVars,
    extra: Partial<NotifyInput> = {},
  ): Promise<number> {
    return this.notify({ recipientIds: userIds, template, vars, ...extra });
  }

  /**
   * Envoi immédiat de messages contenant un secret (lien d'activation, OTP, reset) :
   * le secret n'est jamais stocké en clair ni publié dans un événement.
   */
  async sendDirect(input: DirectInput): Promise<DirectResult> {
    const delivered: NotificationChannel[] = [];
    const failed: NotificationChannel[] = [];
    const tpl = TEMPLATES[input.template];
    for (const channel of input.channels) {
      const to = channel === 'SMS' ? input.to.phone : channel === 'EMAIL' ? input.to.email : null;
      if (!to) continue;
      const full = renderTemplate(input.template, channel, input.language, input.vars, {
        country: input.country,
      });
      const stored = renderTemplate(input.template, channel, input.language, input.vars, {
        country: input.country,
        maskSensitive: true,
      });
      const record = input.userId
        ? await this.prisma.notification.create({
            data: {
              recipientId: input.userId,
              category: tpl.category,
              templateKey: input.template,
              priority: tpl.priority,
              channel,
              status: 'PENDING',
              title: stored.title,
              body: stored.body,
              attempts: 1,
            },
          })
        : null;
      try {
        if (channel === 'SMS') await this.sms.send(to, full.body, record?.id);
        else
          await this.email.send(
            to,
            full.title,
            full.body,
            emailHtml(full.title, full.body),
            record?.id,
          );
        delivered.push(channel);
        if (record) {
          await this.prisma.notification.update({
            where: { id: record.id },
            data: { status: 'SENT', sentAt: this.clock.now() },
          });
        }
      } catch (e) {
        failed.push(channel);
        const reason = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Envoi ${channel} échoué (${input.template}) : ${reason}`);
        if (record) {
          await this.prisma.notification.update({
            where: { id: record.id },
            data: { status: 'FAILED', lastError: reason },
          });
        }
      }
    }
    if (failed.length > 0) {
      // Alerte interne (US-1.1 : « Lien envoyé par email uniquement, alerte interne »).
      await this.audit.record({
        action: 'notification.channel_failure',
        resourceType: 'notification',
        resourceId: input.userId ?? null,
        result: 'FAILURE',
        metadata: { template: input.template, failed, delivered },
      });
    }
    return { delivered, failed };
  }

  /** Annule les notifications programmées d'une clé (ex. rappels d'une contribution payée, US-8.4). */
  async cancelScheduled(dedupePrefix: string, db: DbClient = this.prisma): Promise<number> {
    const res = await db.notification.updateMany({
      where: { dedupeKey: { startsWith: dedupePrefix }, status: { in: ['SCHEDULED', 'PENDING'] } },
      data: { status: 'CANCELLED' },
    });
    return res.count;
  }
}
