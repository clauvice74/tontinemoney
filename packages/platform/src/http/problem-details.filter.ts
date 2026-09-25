import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ERROR_CATALOG, type ErrorCode, type ProblemDetails, problemType } from '@tontine/contracts';
import { type Response } from 'express';
import { ZodError } from 'zod';
import { RequestContext } from '../context/request-context';
import { DomainError } from '../errors/domain-error';
import { zodIssues } from './zod';

const HTTP_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/** Convertit toute erreur en Problem Details (RFC 9457), sans fuite d'information interne. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  constructor(private readonly exposeInternal = false) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.correlationId = RequestContext.correlationId;
    if (problem.status >= 500) {
      this.logger.error(
        exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    if (problem.code === 'RATE_LIMITED' && typeof problem['retryAfter'] === 'number') {
      res.setHeader('Retry-After', String(problem['retryAfter']));
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof DomainError) {
      return {
        type: problemType(exception.code),
        title: exception.title,
        status: exception.status,
        code: exception.code,
        detail: exception.message,
        ...(exception.fieldErrors ? { errors: exception.fieldErrors } : {}),
        ...exception.extra,
      };
    }
    if (exception instanceof ZodError) {
      return this.base('VALIDATION_FAILED', 'Données invalides', zodIssues(exception));
    }
    const multerCode = (exception as { code?: string } | null)?.code;
    if (multerCode === 'LIMIT_FILE_SIZE') return this.base('FILE_TOO_LARGE', 'Fichier trop volumineux');
    if (typeof multerCode === 'string' && multerCode.startsWith('LIMIT_')) {
      return this.base('VALIDATION_FAILED', 'Envoi de fichier invalide');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
      const p = this.base(code, status >= 500 ? undefined : exception.message);
      p.status = status;
      return p;
    }
    const p = this.base('INTERNAL_ERROR', this.exposeInternal && exception instanceof Error ? exception.message : undefined);
    return p;
  }

  private base(code: ErrorCode, detail?: string, errors?: Array<{ path: string; message: string }>): ProblemDetails {
    return {
      type: problemType(code),
      title: ERROR_CATALOG[code].title,
      status: ERROR_CATALOG[code].status,
      code,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
    };
  }
}
