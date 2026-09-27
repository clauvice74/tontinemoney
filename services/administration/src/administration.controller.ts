import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type UpdateConfigurationInput,
  flagFraudSchema,
  updateConfigurationSchema,
} from '@tontine/contracts';
import {
  type Discrepancy,
  InternalReconciliationService,
  reconciliationCsv,
} from '@tontine/transactions';
import { PspReconciliationService } from '@tontine/payments';
import {
  type Actor,
  ApiZodBody,
  ApiZodQuery,
  AuditService,
  CurrentUser,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  Roles,
  UnitOfWork,
  ZodBody,
  ZodQuery,
} from '@tontine/platform';
import { type Response } from 'express';
import { z } from 'zod';
import { ConfigurationService } from './configuration.service';
import { sendReport as send, toPdf } from '@tontine/reporting';

const runSchema = z.object({
  kind: z.enum(['INTERNAL', 'PSP']),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const listSchema = z.object({
  kind: z.enum(['INTERNAL', 'PSP']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const formatSchema = z.object({ format: z.enum(['json', 'csv', 'pdf']).default('json') });

@ApiTags('Administration')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Controller({ version: '1', path: 'admin' })
export class AdministrationController {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly internal: InternalReconciliationService,
    private readonly psp: PspReconciliationService,
    private readonly configuration: ConfigurationService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  @Get('configurations')
  @ApiOperation({
    summary: 'Paramètres modifiables à chaud : valeur, défaut, description, version',
  })
  async configurations() {
    return { data: await this.configuration.list() };
  }

  @Patch('configurations/:key')
  @ApiOperation({
    summary:
      'Modifier un paramètre (valeur bornée, motif obligatoire, verrou optimiste par version)',
  })
  @ApiZodBody(updateConfigurationSchema)
  async updateConfiguration(
    @CurrentUser() actor: Actor,
    @Param('key') key: string,
    @ZodBody(updateConfigurationSchema) body: UpdateConfigurationInput,
  ) {
    return this.configuration.update(actor, key, body);
  }

  @Get('configurations/:key/history')
  @ApiOperation({ summary: 'Historique des modifications d’un paramètre (ajout seul)' })
  async configurationHistory(@Param('key') key: string) {
    return { data: await this.configuration.history(key) };
  }

  @Get('reconciliation')
  @ApiOperation({ summary: 'Rapports de réconciliation (interne US-6.6, PSP US-7.6)' })
  @ApiZodQuery(listSchema)
  async list(@ZodQuery(listSchema) q: z.infer<typeof listSchema>) {
    const rows = await this.internal.listReports(q.kind, q.limit);
    return {
      data: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        businessDate: r.businessDate.toISOString().slice(0, 10),
        status: r.status,
        checkedCount: r.checkedCount,
        discrepancyCount: r.discrepancyCount,
        thresholdMinor: r.thresholdMinor.toString(),
        alert: r.alert,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Post('reconciliation/run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lancer une réconciliation (interne ou PSP)' })
  @ApiZodBody(runSchema)
  async run(@ZodBody(runSchema) body: z.infer<typeof runSchema>) {
    return body.kind === 'PSP' ? this.psp.run(body.date) : this.internal.run();
  }

  @Get('reconciliation/:id')
  @ApiOperation({
    summary: 'Détail d’un rapport de réconciliation (JSON, CSV ou PDF des lignes discordantes)',
  })
  @ApiZodQuery(formatSchema)
  async one(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodQuery(formatSchema) q: z.infer<typeof formatSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.internal.getReport(id);
    if (!r) throw new DomainError('NOT_FOUND', 'Rapport introuvable');
    const rows = r.details as unknown as Discrepancy[];
    const name = `reconciliation-${r.kind.toLowerCase()}-${r.businessDate.toISOString().slice(0, 10)}`;
    if (q.format === 'csv')
      return send(res, {
        filename: `${name}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(`\uFEFF${reconciliationCsv(rows)}`, 'utf8'),
      });
    if (q.format === 'pdf') {
      const pdf = await toPdf({
        title: `Réconciliation ${r.kind === 'PSP' ? 'PSP' : 'interne'} — ${r.businessDate.toISOString().slice(0, 10)}`,
        subtitle: r.alert
          ? 'ALERTE : écarts au-delà du seuil'
          : r.status === 'BALANCED'
            ? 'Aucun écart'
            : 'Écarts sous le seuil',
        generatedAt: r.createdAt,
        summary: [
          ['Éléments contrôlés', String(r.checkedCount)],
          ['Écarts', String(r.discrepancyCount)],
          ['Seuil (unités mineures)', r.thresholdMinor.toString()],
        ],
        sections: [
          {
            heading: 'Lignes discordantes',
            table: {
              columns: ['Type', 'Référence', 'Attendu', 'Constaté', 'Écart', 'Détail'],
              rows: rows.map((d) => [
                d.kind,
                d.reference,
                d.expected,
                d.actual,
                d.deltaMinor,
                d.detail,
              ]),
            },
          },
        ],
      });
      return send(res, { filename: `${name}.pdf`, contentType: 'application/pdf', body: pdf });
    }
    return {
      id: r.id,
      kind: r.kind,
      businessDate: r.businessDate.toISOString().slice(0, 10),
      status: r.status,
      alert: r.alert,
      checkedCount: r.checkedCount,
      discrepancyCount: r.discrepancyCount,
      thresholdMinor: r.thresholdMinor.toString(),
      discrepancies: rows,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** A-14 — signalement de fraude : suspension du membre et gel du wallet (consommateurs). */
  @Post('fraud/flag')
  @HttpCode(202)
  @ApiOperation({ summary: 'Signaler une fraude (suspension + gel du portefeuille)' })
  @ApiZodBody(flagFraudSchema)
  async flag(
    @CurrentUser() actor: Actor,
    @ZodBody(flagFraudSchema) body: { memberId: string; reason: string },
  ) {
    const m = await this.members.snapshot(body.memberId);
    if (!m) throw new DomainError('NOT_FOUND', 'Membre introuvable');
    await this.uow.run(async (tx) => {
      await this.outbox.add(tx, {
        type: 'fraud.user.flagged',
        aggregateType: 'member',
        aggregateId: body.memberId,
        payload: { memberId: body.memberId, reason: body.reason, flaggedBy: actor.userId },
      });
      await this.audit.record(
        {
          action: 'fraud.flagged',
          resourceType: 'member',
          resourceId: body.memberId,
          result: 'SUCCESS',
          metadata: { reason: body.reason },
        },
        tx,
      );
    });
    return { accepted: true };
  }
}
