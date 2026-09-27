import { Inject, Injectable } from '@nestjs/common';
import { type ReportQuery, formatMoney } from '@tontine/contracts';
import { type RptContribution, type RptCycle, type RptTontine } from '@tontine/database';
import {
  type Actor,
  AuditService,
  Clock,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  PrismaService,
} from '@tontine/platform';
import { TontinesService } from '@tontine/tontines';
import { createHash } from 'node:crypto';
import { type ReportDocument, type ReportTable, toCsv, toPdf } from './render';

const PAID = ['PAID', 'PAID_LATE'];
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const STATUS_FR: Record<string, string> = {
  PENDING: 'À payer',
  PAID: 'Payée',
  LATE: 'En retard',
  PAID_LATE: 'Payée en retard',
  DEFAULTED: 'En défaut',
  IN_PROGRESS: 'En cours',
  PAYOUT_PENDING: 'Paiement en attente',
  PAYOUT_PROCESSING: 'Paiement en cours',
  COMPLETED: 'Terminé',
};
/** A-18 : rapports archivés 5 ans minimum (US-4.9 §6). */
export const REPORT_RETENTION_YEARS = 5;

export interface ReportOutput {
  kind: string;
  format: 'json' | 'csv' | 'pdf';
  filename: string;
  contentType: string;
  body: Buffer | object;
}

type Tontine = RptTontine;
type Contribution = RptContribution;
type CycleWithContribs = RptCycle & { contributions: Contribution[] };

/**
 * US-10.4 — rapports financiers par tontine (isolation : admin de la tontine ou super-admin) :
 * bilan par tour, mensuel, annuel, historique des contributions et des pénalités, rapport final
 * de clôture (US-4.9). Formats JSON, CSV et PDF. Calculés sur les projections du reporting
 * (étape 6, A-54) : aucune lecture des tables du domaine Tontine ; l'autorisation reste un
 * contrôle synchrone exact auprès du domaine (`getAdministered`).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly tontines: TontinesService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  private money(t: Tontine, minor: bigint | null | undefined): string {
    return formatMoney(minor ?? 0n, t.currency, 'fr-FR');
  }

  private async load(tontineId: string) {
    const t = await this.prisma.rptTontine.findUnique({ where: { id: tontineId } });
    if (!t)
      throw new DomainError(
        'CONFLICT',
        'Rapport en cours de préparation : réessayez dans un instant',
      );
    const [rows, contributions] = await Promise.all([
      this.prisma.rptCycle.findMany({ where: { tontineId }, orderBy: { number: 'asc' } }),
      this.prisma.rptContribution.findMany({
        where: { tontineId },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const cycles: CycleWithContribs[] = rows.map((c) => ({
      ...c,
      contributions: contributions.filter((x) => x.cycleId === c.id),
    }));
    const ids = [
      ...new Set(
        cycles.flatMap((c) => [
          ...(c.beneficiaryId ? [c.beneficiaryId] : []),
          ...c.contributions.map((x) => x.memberId),
        ]),
      ),
    ];
    const snaps = new Map(
      (await this.members.snapshots(ids)).map((s) => [s.id, `${s.firstName} ${s.lastName}`]),
    );
    return { t, cycles, name: (id: string | null) => (id ? (snaps.get(id) ?? '—') : '—') };
  }

  private cycleTable(
    t: Tontine,
    cycles: CycleWithContribs[],
    name: (id: string | null) => string,
  ): ReportTable {
    return {
      columns: [
        'Tour',
        'Échéance',
        'Statut',
        'Bénéficiaire',
        'Attendu',
        'Collecté',
        'Versé',
        'Pénalités',
        'Payées / membres',
        'Terminé le',
      ],
      rows: cycles.map((c) => [
        c.number,
        iso(c.dueDate),
        (STATUS_FR[c.status] ?? c.status) + (c.partialPayout ? ' (partiel)' : ''),
        name(c.beneficiaryId),
        this.money(t, c.expectedMinor),
        this.money(t, c.collectedMinor),
        c.payoutMinor !== null ? this.money(t, c.payoutMinor) : '',
        this.money(
          t,
          c.contributions.filter((x) => x.penaltyPaid).reduce((s, x) => s + x.penaltyMinor, 0n),
        ),
        `${c.contributions.filter((x) => PAID.includes(x.status)).length} / ${c.contributions.length}`,
        iso(c.completedAt),
      ]),
    };
  }

  private contributionTable(
    t: Tontine,
    cycles: CycleWithContribs[],
    name: (id: string | null) => string,
    filter: (c: Contribution) => boolean,
  ): ReportTable {
    return {
      columns: [
        'Tour',
        'Membre',
        'Échéance',
        'Statut',
        'Montant',
        'Pénalité',
        'Pénalité payée',
        'Payée le',
      ],
      rows: cycles.flatMap((cy) =>
        cy.contributions
          .filter(filter)
          .map((c) => [
            cy.number,
            name(c.memberId),
            iso(c.dueDate),
            STATUS_FR[c.status] ?? c.status,
            this.money(t, c.amountMinor),
            c.penaltyMinor > 0n ? this.money(t, c.penaltyMinor) : '',
            c.penaltyMinor > 0n ? (c.penaltyPaid ? 'oui' : 'non') : '',
            iso(c.paidAt),
          ]),
      ),
    };
  }

  /** Construit le document d'un rapport (données communes aux trois formats). */
  async build(
    tontineId: string,
    q: ReportQuery,
  ): Promise<{ doc: ReportDocument; table: ReportTable; data: object }> {
    const { t, cycles, name } = await this.load(tontineId);
    const now = this.clock.now();
    const all = cycles.flatMap((c) => c.contributions);
    const collected = all
      .filter((c) => PAID.includes(c.status))
      .reduce((s, c) => s + c.amountMinor, 0n);
    const penalties = all.filter((c) => c.penaltyPaid).reduce((s, c) => s + c.penaltyMinor, 0n);
    const paidOut = cycles.reduce((s, c) => s + (c.payoutMinor ?? 0n), 0n);
    const base: Array<[string, string]> = [
      ['Tontine', t.name],
      ['Statut', t.status],
      ['Contribution', `${this.money(t, t.contributionMinor)} (${t.frequency})`],
      [
        'Cycles',
        `${cycles.filter((c) => c.status === 'COMPLETED').length} / ${t.totalCycles ?? '—'}`,
      ],
    ];
    const footer =
      'Document généré par TontineMoney (données de démonstration, prestataires simulés). Montants en unités de la devise de la tontine.';
    const inRange = (d: Date | null, from?: Date, to?: Date) =>
      !!d && (!from || d >= from) && (!to || d < to);

    switch (q.kind) {
      case 'CYCLE': {
        const selected = q.cycleNumber ? cycles.filter((c) => c.number === q.cycleNumber) : cycles;
        if (q.cycleNumber && selected.length === 0)
          throw new DomainError('NOT_FOUND', 'Tour introuvable');
        const table = this.cycleTable(t, selected, name);
        const sections = [
          { heading: 'Bilan par tour', table },
          ...selected.map((c) => ({
            heading: `Tour ${c.number} — contributions`,
            table: this.contributionTable(t, [c], name, () => true),
          })),
        ];
        return {
          doc: {
            title: `Bilan par tour — ${t.name}`,
            subtitle: q.cycleNumber ? `Tour ${q.cycleNumber}` : 'Tous les tours',
            generatedAt: now,
            summary: base,
            sections,
            footer,
          },
          table,
          data: { tontine: t.name, cycles: table.rows },
        };
      }
      case 'MONTHLY':
      case 'ANNUAL': {
        const year = q.year ?? now.getUTCFullYear();
        const months =
          q.kind === 'MONTHLY'
            ? [q.month ?? now.getUTCMonth() + 1]
            : Array.from({ length: 12 }, (_, i) => i + 1);
        const rows = months.map((m) => {
          const from = new Date(Date.UTC(year, m - 1, 1));
          const to = new Date(Date.UTC(year, m, 1));
          const paid = all.filter((c) => PAID.includes(c.status) && inRange(c.paidAt, from, to));
          const pen = all.filter((c) => c.penaltyPaid && inRange(c.paidAt, from, to));
          const payouts = cycles.filter((c) => inRange(c.completedAt, from, to));
          return [
            `${year}-${String(m).padStart(2, '0')}`,
            paid.length,
            this.money(
              t,
              paid.reduce((s, c) => s + c.amountMinor, 0n),
            ),
            this.money(
              t,
              pen.reduce((s, c) => s + c.penaltyMinor, 0n),
            ),
            payouts.length,
            this.money(
              t,
              payouts.reduce((s, c) => s + (c.payoutMinor ?? 0n), 0n),
            ),
          ] as Array<string | number>;
        });
        const table: ReportTable = {
          columns: [
            'Mois',
            'Contributions reçues',
            'Montant reçu',
            'Pénalités encaissées',
            'Tours payés',
            'Montant versé',
          ],
          rows,
        };
        const label =
          q.kind === 'MONTHLY' ? `${year}-${String(months[0]).padStart(2, '0')}` : String(year);
        return {
          doc: {
            title: `Bilan ${q.kind === 'MONTHLY' ? 'mensuel' : 'annuel'} — ${t.name}`,
            subtitle: label,
            generatedAt: now,
            summary: base,
            sections: [{ heading: 'Synthèse', table }],
            footer,
          },
          table,
          data: { period: label, rows },
        };
      }
      case 'CONTRIBUTIONS':
      case 'PENALTIES': {
        const from = q.from ? new Date(`${q.from}T00:00:00Z`) : undefined;
        const to = q.to
          ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000)
          : undefined;
        const filter = (c: Contribution) =>
          (q.kind === 'PENALTIES' ? c.penaltyMinor > 0n : true) &&
          (!from || c.dueDate >= from) &&
          (!to || c.dueDate < to);
        const table = this.contributionTable(t, cycles, name, filter);
        const title =
          q.kind === 'PENALTIES' ? 'Historique des pénalités' : 'Historique des contributions';
        return {
          doc: {
            title: `${title} — ${t.name}`,
            subtitle: `${q.from ?? 'début'} → ${q.to ?? 'aujourd’hui'}`,
            generatedAt: now,
            summary: base,
            sections: [{ heading: title, table }],
            footer,
          },
          table,
          data: { rows: table.rows },
        };
      }
      case 'FINAL': {
        const reserve = t.reserveWalletId
          ? await this.prisma.rptWallet.findUnique({ where: { id: t.reserveWalletId } })
          : null;
        const table = this.cycleTable(t, cycles, name);
        const summary: Array<[string, string]> = [
          ...base,
          ['Début', iso(t.startedAt)],
          ['Clôture', iso(t.completedAt) || 'non clôturée'],
          ['Total collecté', this.money(t, collected)],
          ['Total versé aux bénéficiaires', this.money(t, paidOut)],
          ['Pénalités encaissées', this.money(t, penalties)],
          ['Solde de la réserve (A-08)', this.money(t, reserve?.balanceMinor ?? 0n)],
          ['Preuve du tirage (SHA-256)', t.drawProof ?? '—'],
        ];
        return {
          doc: {
            title: `Rapport final — ${t.name}`,
            subtitle: `Archivé jusqu’au ${iso(t.archivedUntil) || '—'}`,
            generatedAt: now,
            summary,
            sections: [
              { heading: 'Cycles et bénéficiaires', table },
              {
                heading: 'Historique des contributions',
                table: this.contributionTable(t, cycles, name, () => true),
              },
              {
                heading: 'Pénalités',
                table: this.contributionTable(t, cycles, name, (c) => c.penaltyMinor > 0n),
              },
            ],
            footer,
          },
          table,
          data: { summary: Object.fromEntries(summary), cycles: table.rows },
        };
      }
    }
  }

  async generate(actor: Actor, tontineId: string, q: ReportQuery): Promise<ReportOutput> {
    await this.tontines.getAdministered(actor, tontineId);
    // Rapport final archivé : restitué tel qu'il a été figé à la clôture
    if (q.kind === 'FINAL' && q.format === 'pdf') {
      const stored = await this.prisma.generatedReport.findFirst({
        where: { tontineId, kind: 'FINAL', format: 'pdf' },
        orderBy: { createdAt: 'desc' },
      });
      if (stored) {
        await this.audit.record({
          action: 'report.downloaded',
          resourceType: 'tontine',
          resourceId: tontineId,
          result: 'SUCCESS',
          metadata: { kind: 'FINAL', format: 'pdf', reportId: stored.id },
        });
        return {
          kind: 'FINAL',
          format: 'pdf',
          filename: `rapport-final-${tontineId}.pdf`,
          contentType: 'application/pdf',
          body: Buffer.from(stored.content),
        };
      }
    }
    const { doc, table, data } = await this.build(tontineId, q);
    await this.audit.record({
      action: 'report.generated',
      resourceType: 'tontine',
      resourceId: tontineId,
      result: 'SUCCESS',
      metadata: { kind: q.kind, format: q.format },
    });
    const filename = `rapport-${q.kind.toLowerCase()}-${tontineId.slice(0, 8)}-${this.clock.today()}`;
    if (q.format === 'csv')
      return {
        kind: q.kind,
        format: 'csv',
        filename: `${filename}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(toCsv(table), 'utf8'),
      };
    if (q.format === 'pdf')
      return {
        kind: q.kind,
        format: 'pdf',
        filename: `${filename}.pdf`,
        contentType: 'application/pdf',
        body: await toPdf(doc),
      };
    return {
      kind: q.kind,
      format: 'json',
      filename: `${filename}.json`,
      contentType: 'application/json',
      body: {
        kind: q.kind,
        title: doc.title,
        subtitle: doc.subtitle ?? null,
        generatedAt: doc.generatedAt.toISOString(),
        summary: doc.summary ?? [],
        table,
        data,
      },
    };
  }

  /**
   * US-4.9 §4 — rapport final PDF généré et archivé automatiquement à la clôture. Les
   * projections peuvent être en retard sur l'événement de clôture (topics distincts) : tant que
   * tous les tours n'y sont pas terminés, l'archivage échoue et sera relancé (redélivrance).
   */
  async archiveFinalReport(tontineId: string): Promise<{ id: string; sha256: string }> {
    const existing = await this.prisma.generatedReport.findFirst({
      where: { tontineId, kind: 'FINAL', format: 'pdf' },
    });
    if (existing) return { id: existing.id, sha256: existing.sha256 };
    const t = await this.prisma.rptTontine.findUnique({ where: { id: tontineId } });
    const done = await this.prisma.rptCycle.count({ where: { tontineId, status: 'COMPLETED' } });
    if (!t || done < (t.totalCycles ?? 0))
      throw new Error(`Projections de la tontine ${tontineId} incomplètes : archivage différé`);
    const { doc } = await this.build(tontineId, { kind: 'FINAL', format: 'pdf' });
    const pdf = await toPdf(doc);
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const now = this.clock.now();
    const r = await this.prisma.generatedReport.create({
      data: {
        tontineId,
        kind: 'FINAL',
        format: 'pdf',
        title: doc.title,
        sha256,
        sizeBytes: pdf.length,
        content: new Uint8Array(pdf),
        retainUntil: new Date(
          Date.UTC(
            now.getUTCFullYear() + REPORT_RETENTION_YEARS,
            now.getUTCMonth(),
            now.getUTCDate(),
          ),
        ),
        createdAt: now,
      },
    });
    await this.audit.record({
      action: 'report.final.archived',
      resourceType: 'tontine',
      resourceId: tontineId,
      result: 'SUCCESS',
      metadata: { reportId: r.id, sha256 },
    });
    return { id: r.id, sha256 };
  }
}
