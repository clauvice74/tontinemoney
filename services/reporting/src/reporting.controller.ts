import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type PlatformReport,
  type PlatformReportExport,
  type PlatformReportQuery,
  type ReportQuery,
  platformReportExportSchema,
  platformReportQuerySchema,
  reportQuerySchema,
} from '@tontine/contracts';
import {
  type Actor,
  ApiZodQuery,
  CurrentUser,
  RequirePermission,
  Roles,
  ZodQuery,
} from '@tontine/platform';
import { type Response } from 'express';
import { AdminDashboardService } from './dashboard.service';
import { PlatformReportsService } from './platform-reports.service';
import { ReportsService } from './reports.service';

/** Réponse JSON ou fichier téléchargé (CSV, PDF). */
export function send(
  res: Response,
  out: { filename: string; contentType: string; body: Buffer | object },
) {
  if (!Buffer.isBuffer(out.body)) return out.body;
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(out.body);
}

@ApiTags('Rapports')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('tontines/:id/reports')
  @ApiOperation({
    summary:
      'Rapports financiers de la tontine (US-10.4) — JSON, CSV ou PDF ; rapport final archivé (US-4.9)',
  })
  @ApiZodQuery(reportQuerySchema)
  async report(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodQuery(reportQuerySchema) q: ReportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.reports.generate(actor, id, q));
  }
}

/** Rapports consolidés de la plateforme : agrégats sans donnée personnelle (super-admin). */
@ApiTags('Rapports')
@ApiBearerAuth()
@RequirePermission('platform.reports.view')
@Controller({ version: '1', path: 'reports' })
export class PlatformReportsController {
  constructor(private readonly reports: PlatformReportsService) {}

  private async one(
    report: PlatformReport,
    { format, ...params }: PlatformReportQuery,
    res: Response,
  ) {
    return send(res, await this.reports.generate(report, params, format));
  }

  @Get('financial')
  @ApiOperation({ summary: 'Flux financiers : transactions, flux nets, échecs, paiements PSP' })
  @ApiZodQuery(platformReportQuerySchema)
  async financial(
    @ZodQuery(platformReportQuerySchema) q: PlatformReportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.one('financial', q, res);
  }

  @Get('contributions')
  @ApiOperation({ summary: 'Contributions : statuts, ponctualité, pénalités' })
  @ApiZodQuery(platformReportQuerySchema)
  async contributions(
    @ZodQuery(platformReportQuerySchema) q: PlatformReportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.one('contributions', q, res);
  }

  @Get('wallets')
  @ApiOperation({ summary: 'Portefeuilles : soldes et montants bloqués, mouvements de la période' })
  @ApiZodQuery(platformReportQuerySchema)
  async wallets(
    @ZodQuery(platformReportQuerySchema) q: PlatformReportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.one('wallets', q, res);
  }

  @Get('compliance')
  @ApiOperation({ summary: 'Conformité : membres, KYC, AML, violations, dossiers' })
  @ApiZodQuery(platformReportQuerySchema)
  async compliance(
    @ZodQuery(platformReportQuerySchema) q: PlatformReportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.one('compliance', q, res);
  }

  @Get('tontines')
  @ApiOperation({ summary: 'Tontines : statuts, créations, participants, tours terminés' })
  @ApiZodQuery(platformReportQuerySchema)
  async tontines(
    @ZodQuery(platformReportQuerySchema) q: PlatformReportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.one('tontines', q, res);
  }

  @Get('export')
  @ApiOperation({ summary: 'Télécharger un rapport en CSV (défaut) ou PDF' })
  @ApiZodQuery(platformReportExportSchema)
  async export(
    @ZodQuery(platformReportExportSchema) { report, ...q }: PlatformReportExport,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.one(report, q, res);
  }
}

/** Tableau de bord du super-admin (projections du reporting, A-54). */
@ApiTags('Administration')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Controller({ version: '1', path: 'admin' })
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Tableau de bord : comptes, files KYC et conformité, paiements, exploitation',
  })
  async overview() {
    return this.dashboard.overview();
  }
}
