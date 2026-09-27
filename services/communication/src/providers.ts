import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { maskEmail, maskPhone } from '@tontine/contracts';
import { APP_CONFIG, PrismaService } from '@tontine/platform';
import nodemailer, { type Transporter } from 'nodemailer';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderResult {
  providerRef: string;
}

/** Contexte consigné au journal de livraison (limite anti-spam par destinataire). */
export interface DeliveryContext {
  notificationId?: string | null;
  recipientId?: string | null;
  priority?: string | null;
}

const logContext = (c: DeliveryContext = {}) => ({
  notificationId: c.notificationId ?? null,
  recipientId: c.recipientId ?? null,
  priority: c.priority ?? null,
});

export abstract class SmsProvider {
  abstract readonly name: string;
  abstract send(to: string, body: string, context?: DeliveryContext): Promise<ProviderResult>;
}

export abstract class EmailProvider {
  abstract readonly name: string;
  abstract send(
    to: string,
    subject: string,
    text: string,
    html: string,
    context?: DeliveryContext,
  ): Promise<ProviderResult>;
}

/**
 * Fournisseur SMS simulé (A-25) : aucun envoi réel. Les messages sont consignés dans
 * `communication.ntf_outbound_messages` (console de dev). Échec déterministe pour les numéros finissant
 * par « 0000 » ou lorsque le simulateur est mis hors service (tests de résilience).
 */
@Injectable()
export class SimulatedSmsProvider extends SmsProvider {
  readonly name = 'sms-simulated';
  private readonly logger = new Logger('SmsSimulator');
  private available = true;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  setAvailability(available: boolean): void {
    this.available = available;
  }

  async send(to: string, body: string, context?: DeliveryContext): Promise<ProviderResult> {
    const failing = !this.available || to.endsWith('0000');
    const msg = await this.prisma.outboundMessage.create({
      data: {
        ...logContext(context),
        channel: 'SMS',
        recipient: to,
        body,
        provider: this.name,
        status: failing ? 'FAILED' : 'DELIVERED',
        error: failing ? 'Fournisseur SMS indisponible (simulation)' : null,
      },
    });
    if (failing) throw new ProviderError('Fournisseur SMS indisponible');
    this.logger.debug(`SMS simulé → ${maskPhone(to)}`);
    return { providerRef: msg.id };
  }
}

/** Email via SMTP (Mailpit en local). */
@Injectable()
export class SmtpEmailProvider extends EmailProvider {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super();
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
    });
  }

  async send(
    to: string,
    subject: string,
    text: string,
    html: string,
    context?: DeliveryContext,
  ): Promise<ProviderResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.config.EMAIL_FROM,
        to,
        subject,
        text,
        html,
      });
      const msg = await this.prisma.outboundMessage.create({
        data: {
          ...logContext(context),
          channel: 'EMAIL',
          recipient: to,
          subject,
          body: text,
          provider: this.name,
          status: 'DELIVERED',
          providerRef: String(info.messageId ?? ''),
        },
      });
      return { providerRef: msg.id };
    } catch (e) {
      await this.prisma.outboundMessage.create({
        data: {
          ...logContext(context),
          channel: 'EMAIL',
          recipient: to,
          subject,
          body: text,
          provider: this.name,
          status: 'FAILED',
          error: e instanceof Error ? e.message : String(e),
        },
      });
      throw new ProviderError(`SMTP indisponible pour ${maskEmail(to)}`);
    }
  }
}

/** Email en mémoire (tests) : consigne seulement dans la table des messages sortants. */
@Injectable()
export class MemoryEmailProvider extends EmailProvider {
  readonly name = 'email-memory';
  private available = true;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  setAvailability(available: boolean): void {
    this.available = available;
  }

  async send(
    to: string,
    subject: string,
    text: string,
    _html: string,
    context?: DeliveryContext,
  ): Promise<ProviderResult> {
    const msg = await this.prisma.outboundMessage.create({
      data: {
        ...logContext(context),
        channel: 'EMAIL',
        recipient: to,
        subject,
        body: text,
        provider: this.name,
        status: this.available ? 'DELIVERED' : 'FAILED',
      },
    });
    if (!this.available) throw new ProviderError('Email indisponible (simulation)');
    return { providerRef: msg.id };
  }
}
