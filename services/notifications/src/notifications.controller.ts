import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AppConfig } from '@tontine/config';
import {
  buildPage,
  decodeCursor,
  maskEmail,
  maskPhone,
  paginationQuerySchema,
} from '@tontine/contracts';
import {
  APP_CONFIG,
  type Actor,
  ApiZodQuery,
  CurrentUser,
  DomainError,
  PrismaService,
  Public,
  ZodQuery,
} from '@tontine/platform';
import { z } from 'zod';

const listSchema = paginationQuerySchema.extend({ unread: z.enum(['true', 'false']).optional() });

@ApiTags('Notifications')
@Controller({ path: 'me/notifications', version: '1' })
export class MyNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Mes notifications in-app (historique)' })
  @ApiZodQuery(listSchema)
  async list(@CurrentUser() actor: Actor, @ZodQuery(listSchema) q: z.infer<typeof listSchema>) {
    const cursor = decodeCursor(q.cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: actor.userId,
        channel: 'IN_APP',
        ...(q.unread === 'true' ? { readAt: null } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(String(cursor.k)) } },
                { createdAt: new Date(String(cursor.k)), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = buildPage(rows, q.limit, (r) => r.createdAt.toISOString());
    const unread = await this.prisma.notification.count({
      where: { recipientId: actor.userId, channel: 'IN_APP', readAt: null },
    });
    return {
      data: page.items.map((n) => ({
        id: n.id,
        category: n.category,
        priority: n.priority,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
      })),
      page: { nextCursor: page.nextCursor, limit: q.limit },
      meta: { unread },
    };
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  async read(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({
      where: { id, recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notification.findFirst({
        where: { id, recipientId: actor.userId },
      });
      if (!exists) throw new DomainError('NOT_FOUND');
    }
  }

  @Post('read-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Tout marquer comme lu' })
  async readAll(@CurrentUser() actor: Actor): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}

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
