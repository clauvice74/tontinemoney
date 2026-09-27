import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AppConfig } from '@tontine/config';
import { maskEmail, maskPhone } from '@tontine/contracts';
import {
  APP_CONFIG,
  ApiZodQuery,
  DomainError,
  PrismaService,
  Public,
  ZodQuery,
} from '@tontine/platform';
import { z } from 'zod';

const devSchema = z.object({
  to: z.string().trim().min(3).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Console des messages sortants simulés (SMS / email) — **désactivée en production** (A-25).
 * Permet de récupérer les OTP et liens d'activation en démonstration locale.
 */
@ApiTags('Développement')
@Controller({ path: 'dev/messages', version: '1' })
export class DevMessagesController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '[DEV] Messages SMS/email simulés (404 en production)' })
  @ApiZodQuery(devSchema)
  async list(@ZodQuery(devSchema) q: z.infer<typeof devSchema>) {
    if (this.config.NODE_ENV === 'production') throw new DomainError('NOT_FOUND');
    const rows = await this.prisma.outboundMessage.findMany({
      where: q.to
        ? { recipient: q.to.toLowerCase().includes('@') ? q.to.toLowerCase() : q.to }
        : {},
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return {
      data: rows.map((m) => ({
        id: m.id,
        channel: m.channel,
        to: m.channel === 'EMAIL' ? m.recipient : m.recipient,
        toMasked: m.channel === 'EMAIL' ? maskEmail(m.recipient) : maskPhone(m.recipient),
        subject: m.subject,
        body: m.body,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }
}
