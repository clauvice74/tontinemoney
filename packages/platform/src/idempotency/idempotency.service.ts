import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '@tontine/database';
import { createHash } from 'node:crypto';
import { Clock } from '../context/clock';
import { PrismaService } from '../context/prisma.service';
import { DomainError } from '../errors/domain-error';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function requestFingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

const TTL_MS = 24 * 3600 * 1000;

/**
 * Clés d'idempotence (docs/security-model.md §4) :
 * même clé + même requête → réponse rejouée ; même clé + requête différente → 422 ;
 * même clé en cours → 409.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async execute<T>(
    params: { scope: string; key: string; userId: string; request: unknown },
    fn: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = requestFingerprint(params.request);
    const where = {
      scope_userId_key: { scope: params.scope, userId: params.userId, key: params.key },
    };
    let recordId: string;
    try {
      const rec = await this.prisma.idempotencyKey.create({
        data: {
          scope: params.scope,
          key: params.key,
          userId: params.userId,
          requestHash,
          expiresAt: new Date(this.clock.now().getTime() + TTL_MS),
        },
      });
      recordId = rec.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await this.prisma.idempotencyKey.findUnique({ where });
      if (!existing) throw new DomainError('IDEMPOTENCY_IN_PROGRESS');
      if (existing.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED');
      if (existing.status === 'IN_PROGRESS') throw new DomainError('IDEMPOTENCY_IN_PROGRESS');
      return {
        status: existing.responseStatus ?? 200,
        body: existing.responseBody as T,
        replayed: true,
      };
    }

    try {
      const result = await fn();
      await this.prisma.idempotencyKey.update({
        where: { id: recordId },
        data: {
          status: 'COMPLETED',
          responseStatus: result.status,
          responseBody: result.body as object,
        },
      });
      return { ...result, replayed: false };
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 409 &&
        error.status !== 429
      ) {
        // Erreur métier déterministe : mémorisée pour un rejeu cohérent.
        await this.prisma.idempotencyKey.update({
          where: { id: recordId },
          data: {
            status: 'COMPLETED',
            responseStatus: error.status,
            responseBody: {
              __error: true,
              code: error.code,
              detail: error.message,
              extra: error.extra,
            } as object,
          },
        });
      } else {
        // Erreur transitoire : la clé est libérée pour permettre un nouvel essai.
        await this.prisma.idempotencyKey.delete({ where: { id: recordId } }).catch(() => undefined);
      }
      throw error;
    }
  }

  async purgeExpired(): Promise<number> {
    const res = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: this.clock.now() } },
    });
    return res.count;
  }
}
