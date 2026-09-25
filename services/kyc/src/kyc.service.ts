import { Inject, Injectable } from '@nestjs/common';
import { sha256Hex } from '@tontine/auth';
import {
  ACCEPTED_IMAGE_MIME,
  COUNTRIES,
  KYC_MAX_FILE_BYTES,
  KYC_MIN_HEIGHT,
  KYC_MIN_WIDTH,
  type KycDocumentType,
  type KycFileKind,
  getCountry,
  isSingleSided,
} from '@tontine/contracts';
import { type KycRequest, isUniqueViolation } from '@tontine/database';
import {
  type Actor,
  AuditService,
  Clock,
  DomainError,
  KvStore,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  UnitOfWork,
} from '@tontine/platform';
import { randomUUID } from 'node:crypto';
import { inspectImage } from './image';
import { DocumentStorage } from './storage';

export const KYC_RETENTION_MS = 7 * 365 * 86_400_000; // R-KYC-06 : 7 ans
const LIVENESS_TTL_SECONDS = 600;

export interface UploadedImage {
  buffer: Buffer;
  originalname?: string;
}

/** Ajoute 24 heures ouvrées (week-ends exclus) : SLA de revue manuelle (US-3.3). */
export function addBusinessDay(from: Date): Date {
  const d = new Date(from.getTime() + 86_400_000);
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Soumission KYC (US-3.1), demande de niveau 3 (A-03), liveness simulée (A-16). */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly kv: KvStore,
    private readonly audit: AuditService,
    private readonly storage: DocumentStorage,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  async requirements(actor: Actor) {
    const m = await this.members.snapshot(actor.userId);
    const country = getCountry(m?.country);
    return {
      country: country?.code ?? null,
      documentTypes: country?.kycDocuments ?? [],
      singleSided: country?.singleSidedDocuments ?? [],
      maxFileBytes: KYC_MAX_FILE_BYTES,
      minWidth: KYC_MIN_WIDTH,
      minHeight: KYC_MIN_HEIGHT,
      acceptedMimeTypes: ACCEPTED_IMAGE_MIME,
      supportedCountries: Object.keys(COUNTRIES),
    };
  }

  /** Session de liveness (simulée) ouverte au moment de la capture caméra. */
  async startLiveness(actor: Actor): Promise<{ livenessToken: string; expiresIn: number }> {
    const token = randomUUID();
    await this.kv.set(`kyc:liveness:${token}`, actor.userId, LIVENESS_TTL_SECONDS);
    return { livenessToken: token, expiresIn: LIVENESS_TTL_SECONDS };
  }

  private async consumeLiveness(memberId: string, token: string): Promise<void> {
    const owner = await this.kv.get(`kyc:liveness:${token}`);
    if (owner !== memberId) {
      throw new DomainError('VALIDATION_FAILED', 'Session de capture caméra invalide ou expirée : reprenez le selfie');
    }
    await this.kv.del(`kyc:liveness:${token}`);
  }

  private validateImage(file: UploadedImage | undefined, label: string): { width: number; height: number; type: string } {
    if (!file) throw new DomainError('VALIDATION_FAILED', `${label} manquant`);
    if (file.buffer.length > KYC_MAX_FILE_BYTES) throw new DomainError('FILE_TOO_LARGE', `${label} : 10 Mo maximum`);
    const info = inspectImage(file.buffer);
    if (!info) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', `${label} : formats acceptés JPEG ou PNG`);
    if (info.width < KYC_MIN_WIDTH || info.height < KYC_MIN_HEIGHT) {
      throw new DomainError('VALIDATION_FAILED', `${label} : résolution minimale ${KYC_MIN_WIDTH}×${KYC_MIN_HEIGHT}`);
    }
    return info;
  }

  /** Clé opaque, groupée par membre sans révéler son identifiant. */
  private storageKey(memberId: string): string {
    const bucket = sha256Hex(`kyc-owner:${memberId}`).slice(0, 16);
    return `kyc/${bucket}/${this.clock.now().getTime()}/${randomUUID()}`;
  }

  private async assertNoOpenRequest(memberId: string): Promise<void> {
    const open = await this.prisma.kycRequest.findFirst({
      where: { memberId, status: { in: ['SUBMITTED', 'PROCESSING', 'REVIEW_REQUIRED'] } },
      select: { id: true },
    });
    if (open) throw new DomainError('KYC_REQUEST_IN_PROGRESS');
  }

  private async persist(
    memberId: string,
    data: { targetLevel: 'TIER_2' | 'TIER_3'; documentType: KycDocumentType; livenessToken: string; incomeSource?: string },
    files: Array<{ kind: KycFileKind; file: UploadedImage; info: { width: number; height: number; type: string } }>,
  ): Promise<KycRequest> {
    const now = this.clock.now();
    const stored: Array<{ kind: KycFileKind; key: string; file: UploadedImage; info: { width: number; height: number; type: string } }> = [];
    for (const f of files) {
      const key = this.storageKey(memberId);
      await this.storage.put(key, f.file.buffer);
      stored.push({ ...f, key });
    }
    try {
      return await this.uow.run(async (tx) => {
        const req = await tx.kycRequest.create({
          data: {
            memberId,
            targetLevel: data.targetLevel,
            status: 'SUBMITTED',
            documentType: data.documentType,
            livenessToken: sha256Hex(data.livenessToken),
            incomeSource: data.incomeSource ?? null,
            submittedAt: now,
            retentionUntil: new Date(now.getTime() + KYC_RETENTION_MS),
          },
        });
        for (const s of stored) {
          await tx.kycDocument.create({
            data: {
              requestId: req.id,
              memberId,
              kind: s.kind,
              storageKey: s.key,
              mimeType: s.info.type,
              sizeBytes: s.file.buffer.length,
              sha256: sha256Hex(s.file.buffer.toString('base64')),
              width: s.info.width,
              height: s.info.height,
            },
          });
        }
        await this.outbox.add(tx, {
          type: 'kyc.submitted',
          aggregateType: 'kyc_request',
          aggregateId: req.id,
          payload: { memberId, requestId: req.id, kycLevel: data.targetLevel, documentTypes: [data.documentType] },
        });
        return req;
      });
    } catch (e) {
      for (const s of stored) await this.storage.delete(s.key);
      if (isUniqueViolation(e)) throw new DomainError('KYC_REQUEST_IN_PROGRESS');
      throw e;
    }
  }

  /** US-3.1 — pièce d'identité (recto, verso si applicable) + selfie caméra. */
  async submit(
    actor: Actor,
    input: { documentType: KycDocumentType; livenessToken: string },
    files: { front?: UploadedImage; back?: UploadedImage; selfie?: UploadedImage },
  ): Promise<{ kycRequestId: string; status: 'SUBMITTED' }> {
    const member = await this.members.snapshot(actor.userId);
    if (!member) throw new DomainError('NOT_FOUND', 'Profil membre introuvable');
    if (member.status === 'SUSPENDED' || member.status === 'PENDING_REVIEW') throw new DomainError('FORBIDDEN', 'Compte suspendu ou en revue');
    if (!member.country) throw new DomainError('BUSINESS_RULE_VIOLATION', 'Renseignez votre pays avant la vérification d’identité');
    const country = getCountry(member.country)!;
    if (!country.kycDocuments.includes(input.documentType)) {
      throw new DomainError('VALIDATION_FAILED', `Type de pièce non accepté pour ${country.nameFr} : ${country.kycDocuments.join(', ')}`);
    }
    await this.assertNoOpenRequest(actor.userId);
    const front = this.validateImage(files.front, 'Recto');
    const needsBack = !isSingleSided(member.country, input.documentType);
    const back = needsBack ? this.validateImage(files.back, 'Verso') : null;
    const selfie = this.validateImage(files.selfie, 'Selfie');
    await this.consumeLiveness(actor.userId, input.livenessToken);
    const req = await this.persist(
      actor.userId,
      { targetLevel: 'TIER_2', documentType: input.documentType, livenessToken: input.livenessToken },
      [
        { kind: 'ID_FRONT', file: files.front!, info: front },
        ...(back ? [{ kind: 'ID_BACK' as const, file: files.back!, info: back }] : []),
        { kind: 'SELFIE', file: files.selfie!, info: selfie },
      ],
    );
    return { kycRequestId: req.id, status: 'SUBMITTED' };
  }

  /** A-03 — demande de niveau 3 : justificatif de domicile + source de revenus + selfie, revue manuelle. */
  async submitTier3(
    actor: Actor,
    input: { incomeSource: string; livenessToken: string },
    files: { proofOfAddress?: UploadedImage; selfie?: UploadedImage },
  ): Promise<{ kycRequestId: string; status: 'SUBMITTED' }> {
    const member = await this.members.snapshot(actor.userId);
    if (!member || member.kycLevel !== 'TIER_2' || member.status !== 'ACTIVE') {
      throw new DomainError('KYC_LEVEL_INSUFFICIENT', 'Le niveau 3 requiert un niveau 2 vérifié et un compte actif');
    }
    await this.assertNoOpenRequest(actor.userId);
    const proof = this.validateImage(files.proofOfAddress, 'Justificatif de domicile');
    const selfie = this.validateImage(files.selfie, 'Selfie');
    await this.consumeLiveness(actor.userId, input.livenessToken);
    const last = await this.prisma.kycRequest.findFirst({ where: { memberId: actor.userId, status: 'VERIFIED' }, orderBy: { submittedAt: 'desc' } });
    const req = await this.persist(
      actor.userId,
      { targetLevel: 'TIER_3', documentType: last?.documentType ?? 'PROOF_OF_ADDRESS', livenessToken: input.livenessToken, incomeSource: input.incomeSource },
      [
        { kind: 'PROOF_OF_ADDRESS', file: files.proofOfAddress!, info: proof },
        { kind: 'SELFIE', file: files.selfie!, info: selfie },
      ],
    );
    return { kycRequestId: req.id, status: 'SUBMITTED' };
  }

  async me(actor: Actor) {
    const member = await this.members.snapshot(actor.userId);
    const rows = await this.prisma.kycRequest.findMany({ where: { memberId: actor.userId }, orderBy: { submittedAt: 'desc' }, take: 20 });
    const view = (r: KycRequest) => ({
      id: r.id,
      targetLevel: r.targetLevel,
      status: r.status,
      documentType: r.documentType,
      submittedAt: r.submittedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      documentExpiresAt: r.documentExpiresAt?.toISOString().slice(0, 10) ?? null,
      rejectCategory: r.rejectCategory,
      rejectReason: r.rejectReason,
    });
    const current = rows[0] ?? null;
    return {
      kycLevel: member?.kycLevel ?? 'NONE',
      memberStatus: member?.status ?? null,
      current: current ? view(current) : null,
      message: current && ['SUBMITTED', 'PROCESSING', 'REVIEW_REQUIRED'].includes(current.status) ? 'Vos documents sont en cours de vérification' : null,
      history: rows.map(view),
    };
  }

  /** Lecture d'un document déchiffré (agents KYC / super-admin, accès journalisé). */
  async readDocument(actor: Actor, documentId: string): Promise<{ data: Buffer; mimeType: string }> {
    const doc = await this.prisma.kycDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new DomainError('NOT_FOUND', 'Document introuvable');
    await this.audit.record({ action: 'kyc.document.read', resourceType: 'kyc_document', resourceId: doc.id, result: 'SUCCESS', metadata: { memberId: doc.memberId, kind: doc.kind, by: actor.role } });
    return { data: await this.storage.get(doc.storageKey), mimeType: doc.mimeType };
  }
}
