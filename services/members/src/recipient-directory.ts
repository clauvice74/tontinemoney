import { Injectable } from '@nestjs/common';
import { type RecipientDirectory, type RecipientProfile } from '@tontine/notifications';
import { PrismaService } from '@tontine/platform';
import { type NotificationPrefsValue } from './domain/profile';

/** Implémentation du port RecipientDirectory pour le domaine Notifications. */
@Injectable()
export class MemberRecipientDirectory implements RecipientDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async getMany(ids: string[]): Promise<RecipientProfile[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.member.findMany({ where: { id: { in: ids } } });
    return rows.map((m) => {
      const prefs = (m.notificationPrefs ?? {}) as Partial<NotificationPrefsValue>;
      return {
        id: m.id,
        firstName: m.firstName,
        email: m.email,
        phone: m.phone,
        language: m.language,
        timezone: m.timezone,
        country: m.countryCode,
        preferredChannel: prefs.preferredChannel ?? 'SMS',
        enabledTypes: prefs.enabledTypes ?? [],
        quietHours: prefs.quietHours ?? null,
      };
    });
  }
}
