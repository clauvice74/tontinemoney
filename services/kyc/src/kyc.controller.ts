import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  KYC_MAX_FILE_BYTES,
  type KycDecisionInput,
  amlResolutionSchema,
  duplicateResolutionSchema,
  kycDecisionSchema,
  kycSubmitSchema,
  kycTier3Schema,
} from '@tontine/contracts';
import { type Actor, ApiZodBody, CurrentUser, RequirePermission, ZodBody, ZodValidationPipe } from '@tontine/platform';
import { type Response } from 'express';
import { z } from 'zod';
import { KycService } from './kyc.service';
import { KycReviewService } from './review.service';

type Files = Record<string, Array<{ buffer: Buffer; originalname: string }> | undefined>;
const first = (files: Files, name: string) => files?.[name]?.[0];
const upload = (fields: string[]) =>
  UseInterceptors(FileFieldsInterceptor(fields.map((name) => ({ name, maxCount: 1 })), { limits: { fileSize: KYC_MAX_FILE_BYTES, files: fields.length } }));
const statusQuery = z.object({ status: z.enum(['OPEN', 'CONFIRMED', 'DISMISSED']).default('OPEN') });

@ApiTags('KYC')
@ApiBearerAuth()
@Controller({ path: 'kyc', version: '1' })
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly review: KycReviewService,
  ) {}

  @Get('requirements')
  @ApiOperation({ summary: 'Pièces acceptées selon mon pays et contraintes de fichier (US-3.1)' })
  async requirements(@CurrentUser() actor: Actor) {
    return this.kyc.requirements(actor);
  }

  @Post('liveness')
  @HttpCode(201)
  @ApiOperation({ summary: 'Démarrer une session de capture caméra (liveness simulée, A-16)' })
  async liveness(@CurrentUser() actor: Actor) {
    return this.kyc.startLiveness(actor);
  }

  @Post('submit')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @upload(['front', 'back', 'selfie'])
  @ApiOperation({ summary: 'Soumettre pièce d’identité (recto/verso) + selfie caméra (US-3.1)' })
  async submit(@CurrentUser() actor: Actor, @Body(new ZodValidationPipe(kycSubmitSchema)) body: z.infer<typeof kycSubmitSchema>, @UploadedFiles() files: Files) {
    return this.kyc.submit(actor, body, { front: first(files, 'front'), back: first(files, 'back'), selfie: first(files, 'selfie') });
  }

  @Post('tier3')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @upload(['proofOfAddress', 'selfie'])
  @ApiOperation({ summary: 'Demander le niveau 3 (justificatif de domicile, source de revenus, selfie) — revue manuelle' })
  async tier3(@CurrentUser() actor: Actor, @Body(new ZodValidationPipe(kycTier3Schema)) body: z.infer<typeof kycTier3Schema>, @UploadedFiles() files: Files) {
    return this.kyc.submitTier3(actor, body, { proofOfAddress: first(files, 'proofOfAddress'), selfie: first(files, 'selfie') });
  }

  @Get('me')
  @ApiOperation({ summary: 'Mon statut KYC et l’historique de mes soumissions' })
  async me(@CurrentUser() actor: Actor) {
    return this.kyc.me(actor);
  }

  // ------------------------------------------------------------ Agents KYC (US-3.3 à 3.5)
  @Get('reviews')
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Dossiers à revoir, triés par ancienneté, avec SLA' })
  async queue(@Query('status') status?: string) {
    return this.review.queue(status === 'SUPPLEMENT_REQUESTED' ? 'SUPPLEMENT_REQUESTED' : 'REVIEW_REQUIRED');
  }

  @Get('requests/:id')
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Détail d’un dossier (documents, scores, alertes, historique)' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.detail(id);
  }

  @Get('documents/:id')
  @RequirePermission('kyc.documents.read')
  @ApiOperation({ summary: 'Image d’un document déchiffrée (accès journalisé)' })
  async document(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const doc = await this.kyc.readDocument(actor, id);
    res.type(doc.mimeType).setHeader('Cache-Control', 'no-store').setHeader('Content-Disposition', 'inline').send(doc.data);
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Décision : accepter (annotation ≥ 10), rejeter (catégorie + commentaire), compléments' })
  @ApiZodBody(kycDecisionSchema)
  async decide(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(kycDecisionSchema) body: KycDecisionInput) {
    const r = await this.review.decide(actor, id, body);
    return { id: r.id, status: r.status, decidedAt: r.decidedAt?.toISOString() ?? null };
  }

  @Get('duplicates')
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Alertes de doublons biométriques (US-3.4)' })
  async duplicates(@Query(new ZodValidationPipe(statusQuery)) q: z.infer<typeof statusQuery>) {
    return this.review.duplicates(q.status);
  }

  @Post('duplicates/:id/resolve')
  @HttpCode(204)
  @RequirePermission('kyc.review')
  @ApiZodBody(duplicateResolutionSchema)
  async resolveDuplicate(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(duplicateResolutionSchema) body: z.infer<typeof duplicateResolutionSchema>): Promise<void> {
    await this.review.resolveDuplicate(actor, id, body.resolution, body.comment);
  }

  @Get('aml-matches')
  @RequirePermission('kyc.review')
  @ApiOperation({ summary: 'Correspondances AML / PEP / sanctions (US-3.5)' })
  async aml(@Query(new ZodValidationPipe(statusQuery)) q: z.infer<typeof statusQuery>) {
    return this.review.amlMatches(q.status);
  }

  @Post('aml-matches/:id/resolve')
  @HttpCode(204)
  @RequirePermission('kyc.review')
  @ApiZodBody(amlResolutionSchema)
  async resolveAml(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(amlResolutionSchema) body: z.infer<typeof amlResolutionSchema>): Promise<void> {
    await this.review.resolveAml(actor, id, body.resolution, body.comment);
  }
}
