import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPage, decodeCursor, paginationQuerySchema } from '@tontine/contracts';
import {
  type Actor,
  ApiZodQuery,
  CurrentUser,
  DomainError,
  PrismaService,
  ZodQuery,
} from '@tontine/platform';
import { z } from 'zod';

const listSchema = paginationQuerySchema.extend({ unread: z.enum(['true', 'false']).optional() });

@ApiTags('Notifications')
@Controller({ version: '1' })
export class MyNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(['me/notifications', 'notifications'])
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

  @Get(['me/notifications/:id', 'notifications/:id'])
  @ApiOperation({ summary: 'Une de mes notifications' })
  async one(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const n = await this.prisma.notification.findFirst({
      where: { id, recipientId: actor.userId, channel: 'IN_APP' },
    });
    if (!n) throw new DomainError('NOT_FOUND');
    return {
      id: n.id,
      category: n.category,
      priority: n.priority,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt?.toISOString() ?? null,
    };
  }

  @Post('me/notifications/:id/read')
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

  @Post('me/notifications/read-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Tout marquer comme lu' })
  async readAll(@CurrentUser() actor: Actor): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
