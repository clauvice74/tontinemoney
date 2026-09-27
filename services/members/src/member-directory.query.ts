import { Injectable } from '@nestjs/common';
import {
  type ListMembersQuery,
  type MemberDirectoryParams,
  decodeCursor,
  encodeCursor,
  maskEmail,
  maskPhone,
} from '@tontine/contracts';
import { Prisma } from '@tontine/database';
import { PrismaService } from '@tontine/platform';

interface Row {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  kycLevel: string;
  createdAt: Date;
  lastActivityAt: Date | null;
  membershipStatus: string;
  membershipRole: string;
  joinedAt: Date;
  sortKey: string;
}

/**
 * Vue de lecture « membres d'une tontine » (US-2.3).
 * Jointure en lecture seule sur `ton_members` (vue de lecture autorisée, docs/architecture.md §4).
 * Aucune donnée sensible (adresse, documents KYC) n'est sélectionnée.
 */
@Injectable()
export class MemberDirectoryQuery {
  constructor(private readonly prisma: PrismaService) {}

  async list(tontineId: string, q: ListMembersQuery) {
    const { sortExpr, cursorFilter, order } = sorting(q.sort, q.cursor);
    const filters: Prisma.Sql[] = [
      Prisma.sql`tm."tontineId" = ${tontineId}::uuid`,
      Prisma.sql`tm."status" <> 'REMOVED'`,
      ...memberFilters(q),
    ];
    if (q.membership === 'ACTIVE') filters.push(Prisma.sql`tm."status" = 'ACTIVE'`);
    if (q.membership === 'PENDING_APPROVAL')
      filters.push(Prisma.sql`tm."status" IN ('PENDING_APPROVAL', 'PENDING_ACTIVATION')`);
    const where = Prisma.join(filters, ' AND ');

    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT ${sortExpr} AS "sortKey", m."id", m."firstName", m."lastName", m."email"::text AS "email", m."phone",
             m."status"::text AS "status", m."kycLevel"::text AS "kycLevel", m."createdAt", m."lastActivityAt",
             tm."status"::text AS "membershipStatus", tm."role"::text AS "membershipRole", tm."joinedAt"
      FROM "ton_members" tm JOIN "mbr_members" m ON m."id" = tm."memberId"
      WHERE ${where} ${cursorFilter}
      ${order}
      LIMIT ${q.limit + 1}`;

    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];

    const counts = await this.prisma.$queryRaw<Array<{ status: string; n: bigint }>>`
      SELECT m."status"::text AS status, count(*)::bigint AS n
      FROM "ton_members" tm JOIN "mbr_members" m ON m."id" = tm."memberId"
      WHERE tm."tontineId" = ${tontineId}::uuid AND tm."status" <> 'REMOVED'
      GROUP BY m."status"`;
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const pending =
      (byStatus['PENDING'] ?? 0) +
      (byStatus['KYC_REQUIRED'] ?? 0) +
      (byStatus['KYC_IN_REVIEW'] ?? 0) +
      (byStatus['PENDING_REVIEW'] ?? 0);

    return {
      data: items.map((r) => ({
        id: r.id,
        fullName: `${r.firstName} ${r.lastName}`,
        firstName: r.firstName,
        lastName: r.lastName,
        email: maskEmail(r.email),
        phone: maskPhone(r.phone),
        status: r.status,
        kycLevel: r.kycLevel,
        membershipStatus: r.membershipStatus,
        membershipRole: r.membershipRole,
        registeredAt: r.createdAt.toISOString(),
        joinedAt: r.joinedAt.toISOString(),
        lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
      })),
      page: {
        nextCursor: hasMore && last ? encodeCursor({ k: last.sortKey, id: last.id }) : null,
        limit: q.limit,
      },
      meta: {
        total,
        active: byStatus['ACTIVE'] ?? 0,
        pending,
        suspended: byStatus['SUSPENDED'] ?? 0,
        summary: `${total} membres (${byStatus['ACTIVE'] ?? 0} actifs, ${pending} en attente, ${byStatus['SUSPENDED'] ?? 0} suspendu${(byStatus['SUSPENDED'] ?? 0) > 1 ? 's' : ''})`,
      },
    };
  }

  /**
   * Annuaire plateforme (personnel). Coordonnées masquées : la fiche complète passe par
   * `GET /members/:id`, dont chaque lecture est journalisée.
   */
  async listPlatform(q: MemberDirectoryParams) {
    const { sortExpr, cursorFilter, order } = sorting(q.sort, q.cursor);
    const filters = memberFilters(q);
    if (q.complianceStatus)
      filters.push(Prisma.sql`m."complianceStatus" = ${q.complianceStatus}::"ComplianceStatus"`);
    if (q.country) filters.push(Prisma.sql`m."countryCode" = ${q.country}`);
    const where = filters.length ? Prisma.join(filters, ' AND ') : Prisma.sql`TRUE`;

    const rows = await this.prisma.$queryRaw<PlatformRow[]>`
      SELECT ${sortExpr} AS "sortKey", m."id", m."firstName", m."lastName", m."email"::text AS "email", m."phone",
             m."countryCode", m."status"::text AS "status", m."kycLevel"::text AS "kycLevel",
             m."complianceStatus"::text AS "complianceStatus", m."createdAt", m."lastActivityAt"
      FROM "mbr_members" m
      WHERE ${where} ${cursorFilter}
      ${order}
      LIMIT ${q.limit + 1}`;

    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return {
      data: items.map((r) => ({
        id: r.id,
        fullName: `${r.firstName} ${r.lastName}`,
        firstName: r.firstName,
        lastName: r.lastName,
        email: maskEmail(r.email),
        phone: maskPhone(r.phone),
        country: r.countryCode,
        status: r.status,
        kycLevel: r.kycLevel,
        complianceStatus: r.complianceStatus,
        registeredAt: r.createdAt.toISOString(),
        lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
      })),
      page: {
        nextCursor: hasMore && last ? encodeCursor({ k: last.sortKey, id: last.id }) : null,
        limit: q.limit,
      },
    };
  }
}

type SortOption = ListMembersQuery['sort'];

interface PlatformRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  countryCode: string | null;
  status: string;
  kycLevel: string;
  complianceStatus: string;
  createdAt: Date;
  lastActivityAt: Date | null;
  sortKey: string;
}

/** Tri + pagination par curseur `(clé de tri, id)` sur l'alias `m` (mbr_members). */
function sorting(sort: SortOption, rawCursor: string | undefined) {
  const sortExpr =
    sort === 'name_asc' || sort === 'name_desc'
      ? Prisma.sql`lower(m."lastName" || ' ' || m."firstName")`
      : sort === 'status'
        ? Prisma.sql`m."status"::text`
        : Prisma.sql`to_char(m."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS')`;
  const desc = sort === 'name_desc' || sort === 'registered_desc';
  const cursor = decodeCursor(rawCursor);
  const cursorFilter = cursor
    ? desc
      ? Prisma.sql`AND (${sortExpr} < ${String(cursor.k)} OR (${sortExpr} = ${String(cursor.k)} AND m."id" < ${cursor.id}::uuid))`
      : Prisma.sql`AND (${sortExpr} > ${String(cursor.k)} OR (${sortExpr} = ${String(cursor.k)} AND m."id" > ${cursor.id}::uuid))`
    : Prisma.empty;
  const order = desc
    ? Prisma.sql`ORDER BY 1 DESC, m."id" DESC`
    : Prisma.sql`ORDER BY 1 ASC, m."id" ASC`;
  return { sortExpr, cursorFilter, order };
}

/** Filtres communs aux deux vues (statut, niveau KYC, date d'inscription, recherche). */
function memberFilters(q: {
  status?: string | undefined;
  kycLevel?: string | undefined;
  registeredFrom?: string | undefined;
  registeredTo?: string | undefined;
  search?: string | undefined;
}): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [];
  if (q.status) filters.push(Prisma.sql`m."status" = ${q.status}::"MemberStatus"`);
  if (q.kycLevel) filters.push(Prisma.sql`m."kycLevel" = ${q.kycLevel}::"KycLevel"`);
  if (q.registeredFrom)
    filters.push(Prisma.sql`m."createdAt" >= ${new Date(`${q.registeredFrom}T00:00:00Z`)}`);
  if (q.registeredTo)
    filters.push(Prisma.sql`m."createdAt" < ${new Date(`${q.registeredTo}T23:59:59.999Z`)}`);
  if (q.search) {
    const pattern = `%${q.search.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // Index GIN trigram mbr_members_search_trgm (US-2.3 notes techniques)
    filters.push(
      Prisma.sql`lower(m."firstName" || ' ' || m."lastName" || ' ' || coalesce(m."email"::text, '') || ' ' || coalesce(m."phone", '')) LIKE ${pattern}`,
    );
  }
  return filters;
}
