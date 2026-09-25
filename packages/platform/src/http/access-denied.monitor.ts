import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../context/request-context';
import { KvStore } from '../kv/kv-store';

export const ACCESS_DENIED_ALERT_THRESHOLD = 20;
const WINDOW_SECONDS = 600;

/**
 * Journalise chaque refus d'accès (US-2.5) et alerte si la fréquence est anormale
 * (> 20 refus / 10 min pour un même utilisateur ou une même IP).
 */
@Injectable()
export class AccessDeniedMonitor {
  private readonly logger = new Logger('SecurityAlert');

  constructor(
    private readonly audit: AuditService,
    private readonly kv: KvStore,
  ) {}

  async record(resourceType: string, resourceId: string | null, reason: string): Promise<void> {
    const ctx = RequestContext.current();
    await this.audit.record({
      action: 'access.denied',
      resourceType,
      resourceId,
      result: 'DENIED',
      metadata: { reason },
    });
    const subject = ctx?.actor?.userId ?? ctx?.ip ?? 'anonymous';
    const count = await this.kv.incr(`denied:${subject}`, WINDOW_SECONDS);
    if (count === ACCESS_DENIED_ALERT_THRESHOLD + 1) {
      this.logger.error(`Fréquence anormale de refus d'accès pour ${subject} (${count} en 10 min)`);
      await this.audit.record({
        action: 'security.alert.access_denied_burst',
        resourceType: 'user',
        resourceId: ctx?.actor?.userId ?? null,
        result: 'DENIED',
        metadata: { count, subject },
      });
    }
  }
}
