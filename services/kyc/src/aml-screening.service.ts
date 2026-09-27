import { Injectable } from '@nestjs/common';
import { DomainError, OutboxService, PrismaService, UnitOfWork } from '@tontine/platform';
import { AmlScreeningProvider, ProviderUnavailableError } from './providers/providers';

/** Périmètre d'un screening : toutes les listes, sanctions seules (OFAC, ONU, UE, Interpol) ou PEP. */
export type ScreeningScope = 'ALL' | 'SANCTIONS' | 'PEP';

export function inScope(listName: string, scope: ScreeningScope): boolean {
  if (scope === 'ALL') return true;
  return scope === 'PEP' ? listName === 'PEP' : listName !== 'PEP';
}

export interface ScreenedMember {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
}

export interface ScreeningHit {
  matchId: string;
  listName: string;
  entryId: string;
  entryName: string;
  entryCountry: string | null;
  score: number;
  status: string;
  /** false : correspondance déjà connue (OPEN ou CONFIRMED), aucune nouvelle alerte. */
  isNew: boolean;
}

/**
 * Screening AML / PEP / sanctions d'un membre (US-3.5). Jamais de rejet automatique : chaque
 * nouvelle correspondance hors liste blanche est persistée pour revue humaine et publiée
 * (`kyc.aml.match`). Une correspondance déjà ouverte ou confirmée n'est pas dupliquée.
 */
@Injectable()
export class AmlScreeningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly aml: AmlScreeningProvider,
  ) {}

  async screenMember(
    m: ScreenedMember,
    scope: ScreeningScope,
    source: 'BATCH' | 'ON_DEMAND',
  ): Promise<{ hits: ScreeningHit[]; whitelisted: number }> {
    let raw;
    try {
      raw = await this.aml.screen(
        `${m.firstName} ${m.lastName}`,
        m.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      );
    } catch (e) {
      if (e instanceof ProviderUnavailableError) throw new DomainError('PROVIDER_UNAVAILABLE');
      throw e;
    }
    const hits: ScreeningHit[] = [];
    let whitelisted = 0;
    for (const h of raw.filter((x) => inScope(x.listName, scope))) {
      const white = await this.prisma.kycAmlWhitelist.findUnique({
        where: {
          memberId_listName_entryId: { memberId: m.id, listName: h.listName, entryId: h.entryId },
        },
      });
      if (white) {
        whitelisted++;
        continue;
      }
      const known = await this.prisma.kycAmlMatch.findFirst({
        where: {
          memberId: m.id,
          listName: h.listName,
          entryId: h.entryId,
          status: { in: ['OPEN', 'CONFIRMED'] },
        },
      });
      const base = {
        listName: h.listName,
        entryId: h.entryId,
        entryName: h.entryName,
        entryCountry: h.entryCountry,
        score: h.score,
      };
      if (known) {
        hits.push({ ...base, matchId: known.id, status: known.status, isNew: false });
        continue;
      }
      const match = await this.uow.run(async (tx) => {
        const created = await tx.kycAmlMatch.create({
          data: {
            memberId: m.id,
            listName: h.listName,
            entryId: h.entryId,
            entryName: h.entryName,
            entryCountry: h.entryCountry,
            entryReason: h.entryReason,
            entryAddedAt: new Date(`${h.entryAddedAt}T00:00:00Z`),
            score: h.score,
            source,
          },
        });
        await this.outbox.add(tx, {
          type: 'kyc.aml.match',
          aggregateType: 'member',
          aggregateId: m.id,
          payload: { memberId: m.id, matchId: created.id, listName: h.listName, score: h.score },
        });
        return created;
      });
      hits.push({ ...base, matchId: match.id, status: match.status, isNew: true });
    }
    return { hits, whitelisted };
  }
}
