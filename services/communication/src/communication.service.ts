import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Clock,
  type CommunicationPort,
  type CommunicationRequest,
  type CommunicationResult,
  CONFIGURATION,
  type DirectDelivery,
  type ConfigurationPort,
  MEMBER_QUERY,
  type MemberQueryPort,
  PrismaService,
} from '@tontine/platform';
import { emailHtml } from './email-html';
import { EmailProvider, ProviderError, SmsProvider } from './providers';

/**
 * Communication (A-51) : **comment** envoyer. Adresse du destinataire (port Membres), limite
 * anti-spam SMS (R-COM-03, paramètre `notifications.sms.dailyLimit`, hors urgences), appel du
 * fournisseur du canal, journal de livraison. Une tentative par appel : le domaine Notifications
 * décide du réessai, de la file d'attente et du repli de canal.
 */
@Injectable()
export class CommunicationService implements CommunicationPort {
  private readonly logger = new Logger(CommunicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly sms: SmsProvider,
    private readonly email: EmailProvider,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
    @Inject(CONFIGURATION) private readonly settings: ConfigurationPort,
  ) {}

  async send(r: CommunicationRequest): Promise<CommunicationResult> {
    const context = {
      notificationId: r.notificationId,
      recipientId: r.recipientId,
      priority: r.priority,
    };
    if (r.channel === 'PUSH') return { status: 'SENT', providerRef: null }; // aucune application mobile en V1
    const contact = await this.members.snapshot(r.recipientId);
    try {
      if (r.channel === 'SMS') {
        if (!contact?.phone) return { status: 'FAILED', retryable: false, reason: 'Aucun numéro' };
        const limit = await this.settings.get('notifications.sms.dailyLimit');
        if (r.priority !== 'URGENT' && (await this.smsSentLast24h(r.recipientId)) >= limit)
          return {
            status: 'THROTTLED',
            reason: `Limite anti-spam de ${limit} SMS/jour atteinte (R-COM-03)`,
          };
        const res = await this.sms.send(contact.phone, r.body, context);
        return { status: 'SENT', providerRef: res.providerRef };
      }
      if (!contact?.email) return { status: 'FAILED', retryable: false, reason: 'Aucun email' };
      const res = await this.email.send(
        contact.email,
        r.subject,
        r.body,
        emailHtml(r.subject, r.body),
        context,
      );
      return { status: 'SENT', providerRef: res.providerRef };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const retryable = !(e instanceof ProviderError) || e.retryable;
      this.logger.warn(`Envoi ${r.channel} de ${r.notificationId} en échec : ${reason}`);
      return { status: 'FAILED', retryable, reason };
    }
  }

  async deliver(d: DirectDelivery): Promise<CommunicationResult> {
    const context = {
      notificationId: d.notificationId ?? null,
      recipientId: d.recipientId ?? null,
    };
    try {
      const res =
        d.channel === 'SMS'
          ? await this.sms.send(d.to, d.body, context)
          : await this.email.send(d.to, d.subject, d.body, emailHtml(d.subject, d.body), context);
      return { status: 'SENT', providerRef: res.providerRef };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return { status: 'FAILED', retryable: !(e instanceof ProviderError) || e.retryable, reason };
    }
  }

  /** SMS non urgents livrés au destinataire sur 24 h glissantes (journal de livraison). */
  private async smsSentLast24h(recipientId: string): Promise<number> {
    return this.prisma.outboundMessage.count({
      where: {
        recipientId,
        channel: 'SMS',
        status: 'DELIVERED',
        priority: { not: 'URGENT' },
        createdAt: { gte: new Date(this.clock.now().getTime() - 86_400_000) },
      },
    });
  }
}
