import { Controller, HttpCode, Inject, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { verifyInternalRequest } from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { paymentNotificationSchema } from '@tontine/contracts';
import { APP_CONFIG, AuditService, Clock, DomainError, Public } from '@tontine/platform';
import { type Request } from 'express';
import { PaymentsService } from './payments.service';

/** Appelants autorisés sur les routes internes du Payment Service. */
export const INTERNAL_CALLERS = ['payment-gateway'] as const;

/**
 * Routes internes (service à service) : jamais exposées par l'API Gateway, authentifiées par
 * HMAC sur le corps brut (`packages/auth/src/internal-signature.ts`), pas par JWT.
 */
@ApiExcludeController()
@Controller({ version: '1', path: 'internal/payments' })
export class InternalPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Notification normalisée et déjà vérifiée par le Payment Gateway. */
  @Post('notifications')
  @Public()
  @HttpCode(200)
  async notification(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const check = verifyInternalRequest(this.config.INTERNAL_SERVICE_SECRET, req.headers, raw, {
      allowedCallers: INTERNAL_CALLERS,
      toleranceSeconds: 60,
      now: this.clock.now(),
    });
    if (!check.ok) {
      await this.audit.record({
        action: 'internal.request.rejected',
        resourceType: 'payment_notification',
        resourceId: null,
        result: 'DENIED',
        metadata: { reason: check.reason },
      });
      throw new DomainError('INVALID_SIGNATURE', 'Appel interne non authentifié');
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'Corps JSON invalide');
    }
    const parsed = paymentNotificationSchema.safeParse(body);
    if (!parsed.success)
      throw new DomainError(
        'VALIDATION_FAILED',
        undefined,
        {},
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    return this.payments.receiveNotification(parsed.data);
  }
}
