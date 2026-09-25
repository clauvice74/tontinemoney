import { Inject, Injectable, Logger } from '@nestjs/common';
import { sha256Hex } from '@tontine/auth';
import { type KycCheckStep, type KycRejectCategory } from '@tontine/contracts';
import { type KycDocument, type KycRequest, type TxClient } from '@tontine/database';
import {
  CircuitBreaker,
  Clock,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  UnitOfWork,
  withRetry,
} from '@tontine/platform';
import { inspectImage } from './image';
import { addBusinessDay } from './kyc.service';
import {
  AmlScreeningProvider,
  BiometricTemplateProvider,
  type CheckResult,
  DocumentQualityProvider,
  FaceMatchProvider,
  type KycSubject,
  OcrProvider,
  TamperDetectionProvider,
  levenshtein,
} from './providers/providers';
import { DocumentStorage } from './storage';

/** Seuils (R-KYC-02, R-KYC-04). */
export const FACE_MATCH_PASS = 85;
export const FACE_MATCH_REVIEW = 70;
export const DUPLICATE_THRESHOLD = 90;
export const NAME_MAX_DISTANCE = 2;
/** Délais de rejeu vers les fournisseurs (retry ×3 avec backoff, puis escalade manuelle). */
export const PROVIDER_RETRY_DELAYS_MS = [100, 400, 1600];

interface StepResult extends CheckResult {
  step: KycCheckStep;
  critical?: KycRejectCategory;
  durationMs: number;
  attempts: number;
}

/**
 * US-3.2 — vérification automatique asynchrone (saga orchestrée) : qualité → OCR → validation
 * du document → face match → doublons biométriques → screening AML. Chaque étape est tracée
 * (kyc_checks) ; un fournisseur indisponible est rejoué 3 fois puis escaladé en revue manuelle.
 */
@Injectable()
export class KycPipelineService {
  private readonly logger = new Logger(KycPipelineService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly storage: DocumentStorage,
    private readonly quality: DocumentQualityProvider,
    private readonly ocr: OcrProvider,
    private readonly faces: FaceMatchProvider,
    private readonly biometrics: BiometricTemplateProvider,
    private readonly aml: AmlScreeningProvider,
    private readonly tamper: TamperDetectionProvider,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  private breaker(name: string): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker(`kyc:${name}`, { failureThreshold: 5, cooldownMs: 60_000 });
      this.breakers.set(name, b);
    }
    return b;
  }

  /** Appel fournisseur protégé : disjoncteur + 3 tentatives ; renvoie `null` si toujours indisponible. */
  private async call<T>(name: string, fn: () => Promise<T>): Promise<{ value: T | null; attempts: number; error?: string }> {
    let attempts = 0;
    try {
      const value = await withRetry(
        async () => {
          attempts++;
          return this.breaker(name).exec(fn);
        },
        { attempts: 3, delaysMs: PROVIDER_RETRY_DELAYS_MS },
      );
      return { value, attempts };
    } catch (e) {
      return { value: null, attempts, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async timed(step: KycCheckStep, fn: () => Promise<Omit<StepResult, 'step' | 'durationMs'>>): Promise<StepResult> {
    const started = Date.now();
    const r = await fn();
    return { ...r, step, durationMs: Date.now() - started };
  }

  async run(requestId: string): Promise<void> {
    const claimed = await this.prisma.kycRequest.updateMany({
      where: { id: requestId, status: 'SUBMITTED' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) return; // déjà traité (idempotence)
    const req = await this.prisma.kycRequest.findUniqueOrThrow({ where: { id: requestId }, include: { documents: true } });
    const member = await this.members.snapshot(req.memberId);
    const subject: KycSubject = {
      memberId: req.memberId,
      firstName: member?.firstName ?? '',
      lastName: member?.lastName ?? '',
      dateOfBirth: member?.dateOfBirth ?? null,
      country: member?.country ?? null,
      documentType: req.documentType,
      today: this.clock.today(),
    };
    const files = new Map<string, { doc: KycDocument; data: Buffer }>();
    for (const d of req.documents) files.set(d.kind, { doc: d, data: await this.storage.get(d.storageKey) });

    const results: StepResult[] = [];
    let extracted: Awaited<ReturnType<OcrProvider['extract']>> | null = null;
    const primary = files.get('ID_FRONT') ?? files.get('PROOF_OF_ADDRESS');
    const selfie = files.get('SELFIE');

    // Étape 1 — qualité
    const quality = await this.timed('QUALITY', async () => {
      const images = [primary, files.get('ID_BACK'), selfie].filter((x): x is { doc: KycDocument; data: Buffer } => !!x);
      let worst: CheckResult = { outcome: 'PASS', details: {} };
      let attempts = 1;
      for (const img of images) {
        const info = inspectImage(img.data) ?? { type: 'image/png' as const, width: 0, height: 0 };
        const res = await this.call('quality', () => this.quality.check(img.data, info));
        attempts = Math.max(attempts, res.attempts);
        if (!res.value) return { outcome: 'REVIEW', details: { error: res.error, escalated: true }, attempts };
        if (res.value.outcome === 'FAIL') worst = { ...res.value, details: { ...res.value.details, kind: img.doc.kind } };
      }
      return { ...worst, attempts, ...(worst.outcome === 'FAIL' ? { critical: 'DOCUMENT_ILLISIBLE' as const } : {}) };
    });
    results.push(quality);

    if (quality.outcome !== 'FAIL' && req.targetLevel === 'TIER_2' && primary) {
      // Étape 2 — OCR
      const ocr = await this.timed('OCR', async () => {
        const res = await this.call('ocr', () => this.ocr.extract(primary.data, files.get('ID_BACK')?.data ?? null, subject));
        if (!res.value) return { outcome: 'REVIEW', details: { error: res.error, escalated: true }, attempts: res.attempts };
        extracted = res.value;
        return { outcome: 'PASS', details: { fields: { ...res.value, documentNumber: `***${res.value.documentNumber.slice(-3)}` } }, attempts: res.attempts };
      });
      results.push(ocr);

      // Étape 3 — validation du document
      results.push(
        await this.timed('DOCUMENT_VALIDATION', async () => {
          const ex = extracted;
          if (!ex) return { outcome: 'REVIEW', details: { reason: 'OCR indisponible' }, attempts: 1 };
          const issues: string[] = [];
          let critical: KycRejectCategory | undefined;
          const d1 = levenshtein(ex.firstName, subject.firstName);
          const d2 = levenshtein(ex.lastName, subject.lastName);
          if (d1 > NAME_MAX_DISTANCE || d2 > NAME_MAX_DISTANCE) issues.push('Nom / prénom incohérents avec le profil');
          const limit = new Date(`${subject.today}T00:00:00Z`);
          limit.setUTCDate(limit.getUTCDate() + 30);
          if (ex.expiresAt <= subject.today) {
            issues.push('Document expiré');
            critical = 'DOCUMENT_EXPIRE'; // R-KYC-03
          } else if (ex.expiresAt <= limit.toISOString().slice(0, 10)) {
            issues.push('Document expirant dans moins de 30 jours');
          }
          if (!/^[A-Z0-9]{6,20}$/.test(ex.documentNumber)) issues.push('Format du numéro de document inattendu');
          const t = await this.tamper.detect(primary.data);
          if (t.tampered) issues.push(`Manipulation suspectée (${t.signals.join(', ')})`);
          return {
            outcome: critical ? 'FAIL' : issues.length ? 'REVIEW' : 'PASS',
            details: { issues, nameDistance: { firstName: d1, lastName: d2 }, expiresAt: ex.expiresAt, tamperSignals: t.signals },
            attempts: 1,
            ...(critical ? { critical } : {}),
          };
        }),
      );
    }

    // Étape 4 — face match (selfie ↔ photo du document, ou selfie précédent pour le niveau 3)
    if (quality.outcome !== 'FAIL' && selfie) {
      let reference = primary?.data ?? null;
      if (req.targetLevel === 'TIER_3') {
        const prev = await this.prisma.kycDocument.findFirst({
          where: { memberId: req.memberId, kind: 'SELFIE', requestId: { not: req.id }, request: { status: 'VERIFIED' } },
          orderBy: { createdAt: 'desc' },
        });
        reference = prev ? await this.storage.get(prev.storageKey) : null;
      }
      results.push(
        await this.timed('FACE_MATCH', async () => {
          if (!reference) return { outcome: 'REVIEW', details: { reason: 'Aucune photo de référence' }, attempts: 1 };
          const res = await this.call('face-match', () => this.faces.compare(selfie.data, reference!));
          if (!res.value) return { outcome: 'REVIEW', details: { error: res.error, escalated: true }, attempts: res.attempts };
          const score = res.value.score;
          const outcome = score >= FACE_MATCH_PASS ? 'PASS' : score >= FACE_MATCH_REVIEW ? 'REVIEW' : 'FAIL';
          return { outcome, score, details: { score }, attempts: res.attempts, ...(outcome === 'FAIL' ? { critical: 'FACE_MATCH_ECHOUE' as const } : {}) };
        }),
      );

      // Étape 5 — doublons biométriques (US-3.4)
      results.push(
        await this.timed('DUPLICATE', async () => {
          const template = await this.biometrics.template(selfie.data);
          const others = await this.prisma.kycBiometricTemplate.findMany({ where: { memberId: { not: req.memberId } } });
          let best: { memberId: string; score: number } | null = null;
          for (const o of others) {
            const s = this.biometrics.similarity(template, o.template);
            if (s > DUPLICATE_THRESHOLD && (!best || s > best.score)) best = { memberId: o.memberId, score: s };
          }
          await this.prisma.kycBiometricTemplate.upsert({
            where: { memberId: req.memberId },
            create: { memberId: req.memberId, requestId: req.id, template },
            update: { requestId: req.id, template },
          });
          if (!best) return { outcome: 'PASS', details: { compared: others.length }, attempts: 1 };
          return { outcome: 'REVIEW', score: best.score, details: { duplicateOfMemberId: best.memberId, similarityScore: best.score }, attempts: 1 };
        }),
      );
    }

    // Étape 6 — screening AML / PEP / sanctions (US-3.5 : jamais de rejet automatique)
    if (quality.outcome !== 'FAIL') {
      results.push(
        await this.timed('AML', async () => {
          const res = await this.call('aml', () => this.aml.screen(`${subject.firstName} ${subject.lastName}`, subject.dateOfBirth));
          if (!res.value) return { outcome: 'REVIEW', details: { error: res.error, escalated: true }, attempts: res.attempts };
          const whitelist = await this.prisma.kycAmlWhitelist.findMany({ where: { memberId: req.memberId } });
          const hits = res.value.filter((h) => !whitelist.some((w) => w.listName === h.listName && w.entryId === h.entryId));
          return { outcome: hits.length ? 'REVIEW' : 'PASS', details: { hits, whitelisted: res.value.length - hits.length }, attempts: res.attempts };
        }),
      );
    }

    await this.conclude(req, results, extracted);
  }

  private async conclude(req: KycRequest, results: StepResult[], extracted: { expiresAt: string; documentNumber: string; nationality: string | null } | null): Promise<void> {
    const critical = results.find((r) => r.outcome === 'FAIL' && r.critical);
    const review = results.filter((r) => r.outcome === 'REVIEW' || r.outcome === 'FAIL');
    const now = this.clock.now();
    const status = critical ? 'REJECTED' : review.length || req.targetLevel === 'TIER_3' ? 'REVIEW_REQUIRED' : 'VERIFIED';
    await this.uow.run(async (tx) => {
      for (const r of results) {
        await tx.kycCheck.create({
          data: { requestId: req.id, step: r.step, outcome: r.outcome, score: r.score ?? null, details: r.details as object, durationMs: r.durationMs, attempts: r.attempts, createdAt: now },
        });
      }
      await tx.kycRequest.update({
        where: { id: req.id },
        data: {
          status,
          processedAt: now,
          extracted: extracted ? ({ ...extracted, documentNumber: undefined } as object) : undefined,
          documentNumberHash: extracted ? sha256Hex(extracted.documentNumber) : null,
          documentExpiresAt: extracted ? new Date(`${extracted.expiresAt}T00:00:00Z`) : null,
          documentCountry: extracted?.nationality ?? null,
          ...(status === 'REJECTED'
            ? { rejectCategory: critical!.critical!, rejectReason: this.reasonFor(critical!), decidedBy: 'auto', decidedAt: now }
            : {}),
          ...(status === 'VERIFIED' ? { decidedBy: 'auto', decidedAt: now } : {}),
          ...(status === 'REVIEW_REQUIRED' ? { slaDueAt: addBusinessDay(now) } : {}),
        },
      });
      await this.sideEffects(tx, req, results);
      if (status === 'VERIFIED') {
        await this.outbox.add(tx, {
          type: 'kyc.verified',
          aggregateType: 'kyc_request',
          aggregateId: req.id,
          payload: { memberId: req.memberId, requestId: req.id, kycLevel: req.targetLevel, verifiedAt: now.toISOString(), verifiedBy: 'auto', documentCountry: extracted?.nationality ?? null },
        });
      } else if (status === 'REJECTED') {
        await this.outbox.add(tx, {
          type: 'kyc.rejected',
          aggregateType: 'kyc_request',
          aggregateId: req.id,
          payload: { memberId: req.memberId, requestId: req.id, rejectCategory: critical!.critical!, rejectReason: this.reasonFor(critical!), rejectedBy: 'auto' },
        });
      } else {
        const scores: Record<string, number> = {};
        for (const r of results) if (r.score !== undefined) scores[r.step] = r.score;
        await this.outbox.add(tx, {
          type: 'kyc.review.required',
          aggregateType: 'kyc_request',
          aggregateId: req.id,
          payload: {
            memberId: req.memberId,
            requestId: req.id,
            failedSteps: req.targetLevel === 'TIER_3' && !review.length ? ['TIER_3_MANUAL'] : review.map((r) => r.step),
            scores,
          },
        });
      }
    });
    this.logger.debug(`KYC ${req.id} → ${status}`);
  }

  private reasonFor(r: StepResult): string {
    switch (r.critical) {
      case 'DOCUMENT_EXPIRE':
        return 'Le document est expiré';
      case 'FACE_MATCH_ECHOUE':
        return `Le selfie ne correspond pas à la photo du document (score ${r.score ?? 0} %)`;
      case 'DOCUMENT_ILLISIBLE':
        return 'Qualité d’image insuffisante : merci de soumettre de nouvelles photos nettes et bien éclairées';
      default:
        return 'Vérification refusée';
    }
  }

  /** Alertes doublon (US-3.4) et correspondances AML (US-3.5) persistées pour la revue. */
  private async sideEffects(tx: TxClient, req: KycRequest, results: StepResult[]): Promise<void> {
    const dup = results.find((r) => r.step === 'DUPLICATE' && r.outcome === 'REVIEW');
    if (dup) {
      const d = dup.details as { duplicateOfMemberId: string; similarityScore: number };
      const alert = await tx.kycDuplicateAlert.create({
        data: { memberId: req.memberId, duplicateOfMemberId: d.duplicateOfMemberId, requestId: req.id, similarityScore: d.similarityScore },
      });
      await this.outbox.add(tx, {
        type: 'kyc.duplicate.detected',
        aggregateType: 'kyc_request',
        aggregateId: req.id,
        payload: { memberId: req.memberId, duplicateOfMemberId: d.duplicateOfMemberId, similarityScore: d.similarityScore, alertId: alert.id },
      });
    }
    const aml = results.find((r) => r.step === 'AML' && r.outcome === 'REVIEW');
    const hits = (aml?.details as { hits?: Array<{ listName: string; entryId: string; entryName: string; entryCountry: string | null; entryReason: string; entryAddedAt: string; score: number }> } | undefined)?.hits ?? [];
    for (const h of hits) {
      const m = await tx.kycAmlMatch.create({
        data: {
          memberId: req.memberId,
          requestId: req.id,
          listName: h.listName,
          entryId: h.entryId,
          entryName: h.entryName,
          entryCountry: h.entryCountry,
          entryReason: h.entryReason,
          entryAddedAt: new Date(`${h.entryAddedAt}T00:00:00Z`),
          score: h.score,
          source: 'SUBMISSION',
        },
      });
      await this.outbox.add(tx, {
        type: 'kyc.aml.match',
        aggregateType: 'kyc_request',
        aggregateId: req.id,
        payload: { memberId: req.memberId, matchId: m.id, listName: h.listName, score: h.score },
      });
    }
  }
}
