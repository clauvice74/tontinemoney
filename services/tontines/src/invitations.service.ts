import { Inject, Injectable, Logger } from '@nestjs/common';
import { sha256Hex } from '@tontine/auth';
import { type AppConfig } from '@tontine/config';
import { ComplianceService } from '@tontine/compliance';
import {
  type CreateInvitationInput,
  formatMoney,
  moneyView,
  normalizePhone,
} from '@tontine/contracts';
import { type Tontine, type TontineInvitation, type TxClient } from '@tontine/database';
import { NotificationService } from '@tontine/notifications';
import {
  APP_CONFIG,
  type Actor,
  AuditService,
  Clock,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  type MemberSnapshot,
  OutboxService,
  PrismaService,
  ScheduledJob,
  UnitOfWork,
  kycAtLeast,
} from '@tontine/platform';
import { randomBytes } from 'node:crypto';
import { type Frequency, type FrequencyDetail, frequencyLabel } from './domain/calendar';
import { SEATED_STATUSES, TontinesService } from './tontines.service';

/** US-4.2 §6 : une invitation (lien compris) expire après 7 jours. */
export const INVITATION_TTL_MS = 7 * 86_400_000;
const OPEN_STATUSES = ['DRAFT', 'READY'] as const;

export function invitationView(
  i: TontineInvitation,
  extra: { url?: string | null; code?: string | null; tontine?: Tontine } = {},
) {
  return {
    id: i.id,
    tontineId: i.tontineId,
    channel: i.channel,
    status: i.status,
    email: i.targetEmail,
    phone: i.targetPhone,
    invitedUserId: i.invitedUserId,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    respondedAt: i.respondedAt?.toISOString() ?? null,
    declineReasons: (i.declineReasons as string[] | null) ?? null,
    url: extra.url ?? null,
    code: extra.code ?? null,
    tontine: extra.tontine
      ? {
          id: extra.tontine.id,
          name: extra.tontine.name,
          contribution: moneyView(extra.tontine.contributionMinor, extra.tontine.currency),
          frequency: extra.tontine.frequency,
          frequencyLabel: frequencyLabel(
            extra.tontine.frequency as Frequency,
            extra.tontine.frequencyDetail as FrequencyDetail,
          ),
          startDate: extra.tontine.startDate.toISOString().slice(0, 10),
          status: extra.tontine.status,
        }
      : undefined,
  };
}

/** Invitations (US-4.2) : email, téléphone ou lien partageable ; éligibilité à l'acceptation. */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly tontines: TontinesService,
    private readonly compliance: ComplianceService,
    private readonly notifications: NotificationService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private url(code: string): string {
    return `${this.config.APP_PUBLIC_URL.replace(/\/$/, '')}/invitations/${encodeURIComponent(code)}`;
  }

  private assertOpen(t: Tontine): void {
    if (!(OPEN_STATUSES as readonly string[]).includes(t.status)) {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'Les invitations ne sont possibles qu’avant le démarrage de la tontine (A-06)',
      );
    }
  }

  // ------------------------------------------------------------------ création (admin)
  async create(actor: Actor, tontineId: string, input: CreateInvitationInput) {
    const t = await this.tontines.getAdministered(actor, tontineId, false);
    this.assertOpen(t);
    if ((await this.tontines.seatedCount(t.id)) >= t.maxMembers)
      throw new DomainError('TONTINE_FULL', 'Nombre maximum de membres atteint');

    let target: MemberSnapshot | null = null;
    let targetEmail: string | null = null;
    let targetPhone: string | null = null;
    if (input.channel === 'EMAIL') {
      targetEmail = input.email.toLowerCase();
      target = await this.members.findByIdentifier(targetEmail);
    } else if (input.channel === 'PHONE') {
      targetPhone = normalizePhone(input.phone);
      target = await this.members.findByIdentifier(targetPhone);
    }
    if (target) {
      const m = await this.tontines.membership(t.id, target.id);
      if (m && (SEATED_STATUSES as readonly string[]).includes(m.status))
        throw new DomainError(
          'MEMBER_ALREADY_EXISTS',
          'Cette personne participe déjà à la tontine',
        );
    }
    if (input.channel !== 'LINK') {
      const dup = await this.prisma.tontineInvitation.findFirst({
        where: {
          tontineId: t.id,
          status: 'PENDING',
          expiresAt: { gt: this.clock.now() },
          OR: [
            ...(targetEmail ? [{ targetEmail }] : []),
            ...(targetPhone ? [{ targetPhone }] : []),
            ...(target ? [{ invitedUserId: target.id }] : []),
          ],
        },
      });
      if (dup)
        throw new DomainError(
          'CONFLICT',
          'Une invitation est déjà en attente pour ce destinataire',
        );
    }

    const code = randomBytes(18).toString('base64url');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const invitation = await this.uow.run(async (tx) => {
      if (input.channel === 'LINK') {
        // Un seul lien actif par tontine : le précédent est révoqué
        await tx.tontineInvitation.updateMany({
          where: { tontineId: t.id, channel: 'LINK', status: 'PENDING' },
          data: { status: 'REVOKED' },
        });
        await tx.tontine.update({
          where: { id: t.id },
          data: { invitationLinkHash: sha256Hex(code), invitationLinkExpires: expiresAt },
        });
      }
      const inv = await tx.tontineInvitation.create({
        data: {
          tontineId: t.id,
          channel: input.channel,
          targetEmail,
          targetPhone,
          invitedUserId: target?.id ?? null,
          codeHash: sha256Hex(code),
          invitedById: actor.userId,
          expiresAt,
          createdAt: now,
        },
      });
      await this.outbox.add(tx, {
        type: 'tontine.invitation.sent',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: {
          tontineId: t.id,
          invitationId: inv.id,
          channel: inv.channel,
          invitedUserId: inv.invitedUserId,
        },
      });
      await this.audit.record(
        {
          action: 'tontine.invitation.created',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { invitationId: inv.id, channel: inv.channel },
        },
        tx,
      );
      return inv;
    });

    const delivery =
      input.channel === 'LINK' ? null : await this.deliver(t, invitation, target, code);
    return {
      ...invitationView(invitation, {
        url: input.channel === 'LINK' ? this.url(code) : null,
        code: input.channel === 'LINK' ? code : null,
      }),
      delivery,
    };
  }

  /** US-4.2 §2 : nom, montant, fréquence, date de début + lien de réponse. */
  private async deliver(
    t: Tontine,
    inv: TontineInvitation,
    target: MemberSnapshot | null,
    code: string,
  ) {
    const lang = target?.language ?? 'fr';
    const vars = {
      tontine: t.name,
      montant: formatMoney(
        t.contributionMinor,
        t.currency,
        lang.startsWith('en') ? 'en-US' : 'fr-FR',
      ),
      frequence: frequencyLabel(
        t.frequency as Frequency,
        t.frequencyDetail as FrequencyDetail,
        lang,
      ),
      dateDebut: t.startDate.toISOString().slice(0, 10),
      lien: this.url(code),
    };
    try {
      if (target) {
        await this.notifications.notify({
          recipientIds: [target.id],
          template: 'tontine.invitation',
          vars,
          dedupeKey: `invitation:${inv.id}`,
        });
        return { delivered: ['IN_APP'], failed: [] as string[] };
      }
      return await this.notifications.sendDirect({
        to: { email: inv.targetEmail, phone: inv.targetPhone },
        template: 'tontine.invitation',
        vars,
        language: 'fr',
        channels: inv.channel === 'EMAIL' ? ['EMAIL'] : ['SMS'],
      });
    } catch (e) {
      this.logger.warn(`Invitation ${inv.id} : envoi impossible (${(e as Error).message})`);
      return { delivered: [], failed: [inv.channel === 'EMAIL' ? 'EMAIL' : 'SMS'] };
    }
  }

  async list(actor: Actor, tontineId: string) {
    const t = await this.tontines.getAdministered(actor, tontineId);
    const rows = await this.prisma.tontineInvitation.findMany({
      where: { tontineId: t.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => invitationView(r));
  }

  /** US-4.2 §7 : révocation d'une invitation non encore acceptée. */
  async revoke(actor: Actor, tontineId: string, invitationId: string) {
    const t = await this.tontines.getAdministered(actor, tontineId, false);
    const inv = await this.prisma.tontineInvitation.findFirst({
      where: { id: invitationId, tontineId: t.id },
    });
    if (!inv) throw new DomainError('NOT_FOUND', 'Invitation introuvable');
    if (inv.status !== 'PENDING')
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `Invitation ${inv.status} : révocation impossible`,
      );
    const updated = await this.uow.run(async (tx) => {
      const u = await tx.tontineInvitation.update({
        where: { id: inv.id },
        data: { status: 'REVOKED', respondedAt: this.clock.now() },
      });
      if (inv.channel === 'LINK')
        await tx.tontine.update({
          where: { id: t.id },
          data: { invitationLinkHash: null, invitationLinkExpires: null },
        });
      await this.audit.record(
        {
          action: 'tontine.invitation.revoked',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { invitationId: inv.id },
        },
        tx,
      );
      return u;
    });
    return invitationView(updated);
  }

  // ------------------------------------------------------------------ côté invité
  private targets(inv: TontineInvitation, me: MemberSnapshot): boolean {
    if (inv.channel === 'LINK') return true;
    if (inv.invitedUserId) return inv.invitedUserId === me.id;
    return (
      (!!inv.targetEmail && inv.targetEmail.toLowerCase() === me.email?.toLowerCase()) ||
      (!!inv.targetPhone && inv.targetPhone === me.phone)
    );
  }

  async mine(actor: Actor) {
    const me = await this.members.snapshot(actor.userId);
    if (!me) return [];
    const rows = await this.prisma.tontineInvitation.findMany({
      where: {
        status: 'PENDING',
        channel: { in: ['EMAIL', 'PHONE'] },
        expiresAt: { gt: this.clock.now() },
        OR: [
          { invitedUserId: me.id },
          ...(me.email ? [{ targetEmail: me.email.toLowerCase() }] : []),
          ...(me.phone ? [{ targetPhone: me.phone }] : []),
        ],
      },
      include: { tontine: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .filter((r) => this.targets(r, me))
      .map((r) => invitationView(r, { tontine: r.tontine }));
  }

  private async byCode(code: string): Promise<TontineInvitation & { tontine: Tontine }> {
    const inv = await this.prisma.tontineInvitation.findUnique({
      where: { codeHash: sha256Hex(code.trim()) },
      include: { tontine: true },
    });
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt <= this.clock.now())
      throw new DomainError('NOT_FOUND', 'Invitation invalide ou expirée');
    return inv;
  }

  /** Aperçu public d'un lien d'invitation (informations déjà communiquées par l'invitation). */
  async preview(code: string) {
    const inv = await this.byCode(code);
    const seated = await this.tontines.seatedCount(inv.tontineId);
    return {
      ...invitationView(inv, { tontine: inv.tontine }),
      email: null,
      phone: null,
      invitedUserId: null,
      spotsLeft: Math.max(0, inv.tontine.maxMembers - seated),
    };
  }

  /** `tontineId` (routes imbriquées) : l'invitation doit appartenir à cette tontine. */
  async respond(actor: Actor, invitationId: string, accept: boolean, tontineId?: string) {
    const me = await this.members.snapshot(actor.userId);
    const inv = await this.prisma.tontineInvitation.findUnique({
      where: { id: invitationId },
      include: { tontine: true },
    });
    if (
      !me ||
      !inv ||
      (tontineId !== undefined && inv.tontineId !== tontineId) ||
      inv.channel === 'LINK' ||
      !this.targets(inv, me)
    )
      throw new DomainError('NOT_FOUND', 'Invitation introuvable');
    await this.assertPending(inv);
    if (!accept) {
      const u = await this.prisma.tontineInvitation.update({
        where: { id: inv.id },
        data: { status: 'DECLINED', respondedAt: this.clock.now(), respondedById: me.id },
      });
      return { invitation: invitationView(u), membership: null };
    }
    return this.join(me, inv);
  }

  async acceptCode(actor: Actor, code: string) {
    const me = await this.members.snapshot(actor.userId);
    const inv = await this.byCode(code);
    if (!me || !this.targets(inv, me))
      throw new DomainError('NOT_FOUND', 'Invitation invalide ou expirée');
    return this.join(me, inv);
  }

  private async assertPending(inv: TontineInvitation): Promise<void> {
    if (inv.status === 'PENDING' && inv.expiresAt <= this.clock.now()) {
      await this.prisma.tontineInvitation.updateMany({
        where: { id: inv.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      throw new DomainError('TOKEN_EXPIRED', 'Invitation expirée');
    }
    if (inv.status !== 'PENDING')
      throw new DomainError('INVALID_STATE_TRANSITION', `Invitation ${inv.status}`);
  }

  /** US-4.2 §4 — éligibilité : ACTIVE, KYC ≥ TIER_2, conformité OK, pays (devise) compatible. */
  async eligibility(me: MemberSnapshot, t: Tontine): Promise<string[]> {
    const reasons: string[] = [];
    if (me.status !== 'ACTIVE') reasons.push('Votre compte doit être actif');
    if (!kycAtLeast(me.kycLevel, 'TIER_2'))
      reasons.push('Vérification d’identité de niveau 2 requise');
    const wallet = await this.prisma.wallet.findUnique({
      where: { memberId: me.id },
      select: { currency: true },
    });
    if (!wallet || wallet.currency !== t.currency)
      reasons.push(`Pays non compatible : la tontine est en ${t.currency}`);
    if (me.status === 'ACTIVE') {
      const c = await this.compliance.validate({
        operationType: 'TONTINE_JOIN',
        memberId: me.id,
        amountMinor: t.contributionMinor,
        currency: t.currency,
        context: { tontineId: t.id },
      });
      for (const v of c.violations) reasons.push(`Conformité : ${v.message}`);
    }
    return [...new Set(reasons)];
  }

  private async join(me: MemberSnapshot, inv: TontineInvitation & { tontine: Tontine }) {
    const t = inv.tontine;
    this.assertOpen(t);
    const existing = await this.tontines.membership(t.id, me.id);
    if (existing && (SEATED_STATUSES as readonly string[]).includes(existing.status))
      throw new DomainError('MEMBER_ALREADY_EXISTS', 'Vous participez déjà à cette tontine');
    const reasons = await this.eligibility(me, t);
    if (reasons.length) {
      await this.prisma.tontineInvitation.update({
        where: { id: inv.id },
        data: { declineReasons: reasons },
      });
      throw new DomainError(
        'MEMBER_NOT_ELIGIBLE',
        'Vous ne remplissez pas les conditions pour rejoindre cette tontine',
        { eligible: false, reasons },
      );
    }
    const result = await this.uow.run(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ status: string; maxMembers: number }>>`
        SELECT "status"::text AS status, "maxMembers" FROM "ton_tontines" WHERE "id" = ${t.id}::uuid FOR UPDATE`;
      if (!locked || !(OPEN_STATUSES as readonly string[]).includes(locked.status))
        throw new DomainError(
          'INVALID_STATE_TRANSITION',
          'La tontine n’accepte plus de nouveaux membres',
        );
      const seated = await this.tontines.seatedCount(t.id, tx);
      if (seated >= locked.maxMembers) {
        if (inv.channel === 'LINK') await this.expireLinks(tx, t.id);
        throw new DomainError('TONTINE_FULL', 'Nombre maximum de membres atteint');
      }
      const now = this.clock.now();
      const membership = await tx.tontineMember.upsert({
        where: { tontineId_memberId: { tontineId: t.id, memberId: me.id } },
        create: {
          tontineId: t.id,
          memberId: me.id,
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: now,
          entryFeePaid: t.entryFeeMinor === 0n,
          registeredById: inv.invitedById,
        },
        update: {
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: now,
          entryFeePaid: t.entryFeeMinor === 0n,
          consecutiveDefaults: 0,
        },
      });
      const invitation =
        inv.channel === 'LINK'
          ? inv
          : await tx.tontineInvitation.update({
              where: { id: inv.id },
              data: {
                status: 'ACCEPTED',
                respondedAt: now,
                respondedById: me.id,
                declineReasons: [],
              },
            });
      // US-4.2 §6 : le lien expire quand le nombre maximum est atteint
      if (seated + 1 >= locked.maxMembers) await this.expireLinks(tx, t.id);
      await this.outbox.add(tx, {
        type: 'tontine.member.added',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: { tontineId: t.id, memberId: me.id, position: null },
      });
      await this.audit.record(
        {
          action: 'tontine.member.joined',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { invitationId: inv.id, channel: inv.channel },
        },
        tx,
      );
      return { membership, invitation };
    });
    return {
      invitation: invitationView(result.invitation),
      membership: {
        tontineId: t.id,
        memberId: me.id,
        role: result.membership.role,
        status: result.membership.status,
        entryFeePaid: result.membership.entryFeePaid,
      },
    };
  }

  private async expireLinks(tx: TxClient, tontineId: string): Promise<void> {
    await tx.tontineInvitation.updateMany({
      where: { tontineId, channel: 'LINK', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    await tx.tontine.update({
      where: { id: tontineId },
      data: { invitationLinkHash: null, invitationLinkExpires: null },
    });
  }

  /** Expiration des invitations échues (7 jours). */
  @ScheduledJob({
    name: 'tontines.expire-invitations',
    cron: '0 */15 * * * *',
    description: 'Expiration des invitations de plus de 7 jours (US-4.2 §6)',
  })
  async expireJob(): Promise<{ expired: number }> {
    const res = await this.prisma.tontineInvitation.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: this.clock.now() } },
      data: { status: 'EXPIRED' },
    });
    return { expired: res.count };
  }
}
