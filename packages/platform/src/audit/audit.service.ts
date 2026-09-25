import { Injectable } from '@nestjs/common';
import { type AuditResult } from '@tontine/contracts';
import { type DbClient } from '@tontine/database';
import { PrismaService } from '../context/prisma.service';
import { RequestContext } from '../context/request-context';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: AuditResult;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  actorRole?: string | null;
}

/** Journal d'audit transverse (append-only). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: DbClient = this.prisma): Promise<void> {
    const ctx = RequestContext.current();
    await db.auditLog.create({
      data: {
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        result: entry.result,
        actorId: entry.actorId ?? ctx?.actor?.userId ?? null,
        actorRole:
          entry.actorRole ?? ctx?.actor?.role ?? (ctx?.source === 'http' ? 'ANONYMOUS' : 'SYSTEM'),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent?.slice(0, 255) ?? null,
        country: ctx?.country ?? null,
        correlationId: ctx?.correlationId ?? null,
        metadata: (entry.metadata ?? undefined) as object | undefined,
      },
    });
  }
}
