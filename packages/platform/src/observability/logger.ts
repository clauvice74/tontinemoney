import { type LoggerService } from '@nestjs/common';
import pino, { type Logger as PinoLogger } from 'pino';
import { RequestContext } from '../context/request-context';

/** Chemins masqués dans les logs (secrets, jetons, données personnelles). */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'accessToken',
  '*.accessToken',
  'otp',
  '*.otp',
  'code',
  '*.code',
  'secret',
  '*.secret',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'headers.authorization',
  'headers.cookie',
  'recoveryCodes',
  '*.recoveryCodes',
];

export function createPino(level: string, service = 'tontinemoney-api'): PinoLogger {
  return pino({
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[MASQUÉ]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
      const ctx = RequestContext.current();
      return ctx ? { correlationId: ctx.correlationId, userId: ctx.actor?.userId } : {};
    },
  });
}

/** Adaptateur LoggerService Nest → pino (logs JSON structurés). */
export class AppLogger implements LoggerService {
  constructor(readonly pino: PinoLogger) {}

  log(message: unknown, context?: string): void {
    this.pino.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.pino.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string): void {
    this.pino.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.pino.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.pino.trace({ context }, String(message));
  }
}
