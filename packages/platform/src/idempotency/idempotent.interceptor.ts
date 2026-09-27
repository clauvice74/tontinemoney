import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import { idempotencyKeySchema } from '@tontine/contracts';
import { type Request, type Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { RequestContext } from '../context/request-context';
import { DomainError } from '../errors/domain-error';
import { IdempotencyService } from './idempotency.service';

const IDEMPOTENT_SCOPE = 'tontine:idempotent-scope';

/**
 * Rend un endpoint idempotent : en-tête `Idempotency-Key` obligatoire.
 * À utiliser sur tous les POST financiers.
 */
export function Idempotent(scope: string): MethodDecorator {
  return applyDecorators(
    SetMetadata(IDEMPOTENT_SCOPE, scope),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: 'Clé unique (8-128 caractères) par opération',
    }),
  );
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const scope = this.reflector.get<string>(IDEMPOTENT_SCOPE, context.getHandler());
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const header = req.header('idempotency-key');
    const parsed = idempotencyKeySchema.safeParse(header);
    if (!parsed.success) return from(Promise.reject(new DomainError('IDEMPOTENCY_KEY_REQUIRED')));
    const userId = RequestContext.actor?.userId;
    if (!userId) return from(Promise.reject(new DomainError('UNAUTHENTICATED')));

    return from(
      this.idempotency
        .execute(
          {
            scope,
            key: parsed.data,
            userId,
            request: { body: req.body ?? null, params: req.params ?? {} },
          },
          async () => {
            const body = await lastValueFrom(next.handle());
            return { status: res.statusCode || 200, body };
          },
        )
        .then((result) => {
          if (result.replayed) {
            res.setHeader('Idempotent-Replayed', 'true');
            const b = result.body as {
              __error?: boolean;
              code?: string;
              detail?: string;
              extra?: Record<string, unknown>;
            };
            if (b && b.__error && b.code) {
              throw new DomainError(b.code as never, b.detail, b.extra ?? {});
            }
            res.status(result.status);
          }
          return result.body;
        }),
    );
  }
}
