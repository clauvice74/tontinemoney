import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type TransferInput,
  decodeCursor,
  encodeCursor,
  refundSchema,
  transferSchema,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from '@tontine/contracts';
import {
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  CurrentUser,
  Idempotent,
  PrismaService,
  Roles,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { type Request } from 'express';
import { z } from 'zod';
import { TransactionsService, transactionView } from './transactions.service';
import { TransfersService } from './transfers.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
});

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller({ version: '1' })
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly transfers: TransfersService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('me/wallet/transfers')
  @Idempotent('wallet.transfer')
  @ApiOperation({
    summary: 'Transfert vers un autre membre (US-5.6) — Idempotency-Key obligatoire',
  })
  @ApiZodBody(transferSchema)
  async transfer(
    @CurrentUser() actor: Actor,
    @ZodBody(transferSchema) body: TransferInput,
    @Req() req: Request,
  ) {
    const t = await this.transfers.transfer(actor, body, req.header('idempotency-key') ?? '');
    return transactionView(t);
  }

  private async page(where: object, q: z.infer<typeof listQuery>) {
    const cursor = decodeCursor(q.cursor);
    const rows = await this.prisma.transaction.findMany({
      where: {
        ...where,
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: q.type } : {}),
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
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return {
      data: items.map(transactionView),
      page: {
        nextCursor:
          hasMore && last ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id }) : null,
        limit: q.limit,
      },
    };
  }

  /** Liste filtrée par le porteur du jeton (US-2.5 §4). */
  @Get('me/transactions')
  @ApiOperation({ summary: 'Mes transactions (initiées ou reçues)' })
  @ApiZodQuery(listQuery)
  async mine(@CurrentUser() actor: Actor, @ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.page({ OR: [{ initiatorId: actor.userId }, { beneficiaryId: actor.userId }] }, q);
  }

  @Get('me/transactions/:id')
  @ApiOperation({ summary: 'Détail d’une de mes transactions' })
  async one(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return transactionView(await this.transactions.getForActor(actor, id));
  }

  @Get('admin/transactions')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Toutes les transactions (super-admin)' })
  @ApiZodQuery(listQuery)
  async all(@ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.page({}, q);
  }

  @Get('admin/transactions/:id/audit')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Journal d’audit immuable d’une transaction (US-6.5)' })
  async auditTrail(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.prisma.transactionAuditLog.findMany({
      where: { transactionId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      data: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        retainUntil: r.retainUntil.toISOString(),
      })),
    };
  }

  @Post('admin/transactions/:id/reverse')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Contre-passer une transaction (US-6.4)' })
  @ApiZodBody(refundSchema)
  async reverse(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(refundSchema) body: { reason: string },
  ) {
    return transactionView(await this.transactions.reverse(id, body.reason, actor.userId));
  }
}
