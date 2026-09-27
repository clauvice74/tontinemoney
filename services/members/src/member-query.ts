import { Injectable } from '@nestjs/common';
import { isE164, normalizePhone } from '@tontine/contracts';
import { type Member } from '@tontine/database';
import { type MemberQueryPort, type MemberSnapshot, PrismaService } from '@tontine/platform';

function snap(m: Member): MemberSnapshot {
  return {
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    status: m.status,
    kycLevel: m.kycLevel,
    complianceStatus: m.complianceStatus,
    country: m.countryCode,
    email: m.email,
    phone: m.phone,
    dateOfBirth: m.dateOfBirth ? m.dateOfBirth.toISOString().slice(0, 10) : null,
    language: m.language,
  };
}

/** Implémentation du port MemberQueryPort (lecture d'éligibilité par les autres domaines). */
@Injectable()
export class MemberQueryService implements MemberQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(memberId: string): Promise<MemberSnapshot | null> {
    const m = await this.prisma.member.findUnique({ where: { id: memberId } });
    return m ? snap(m) : null;
  }

  async snapshots(memberIds: string[]): Promise<MemberSnapshot[]> {
    if (memberIds.length === 0) return [];
    const rows = await this.prisma.member.findMany({ where: { id: { in: memberIds } } });
    return rows.map(snap);
  }

  async findByIdentifier(identifier: string): Promise<MemberSnapshot | null> {
    const v = identifier.trim();
    const phone = normalizePhone(v);
    const m = v.includes('@')
      ? await this.prisma.member.findFirst({ where: { email: v.toLowerCase() } })
      : isE164(phone)
        ? await this.prisma.member.findFirst({ where: { phone } })
        : null;
    return m ? snap(m) : null;
  }
}
