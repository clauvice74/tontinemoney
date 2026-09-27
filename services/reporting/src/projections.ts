import { Injectable } from '@nestjs/common';
import { type EventEnvelope, type EventType } from '@tontine/events';
import {
  OnEvent,
  PrismaService,
  type ProjectionDelegate,
  applyRecorded,
  applySnapshot,
} from '@tontine/platform';

interface Spec {
  /** Délégué Prisma de la projection (schéma `reporting`). */
  model: keyof PrismaService &
    (
      | 'rptTontine'
      | 'rptCycle'
      | 'rptContribution'
      | 'rptTontineMember'
      | 'rptWallet'
      | 'rptWalletMovement'
      | 'rptTransaction'
      | 'rptPayment'
      | 'rptMember'
      | 'rptKycRequest'
      | 'rptAmlMatch'
      | 'rptViolation'
      | 'rptCase'
      | 'rptReconciliation'
    );
  /** Montants (texte → bigint). */
  bigint?: readonly string[];
  /** Horodatages et dates (texte ISO → Date). */
  dates?: readonly string[];
  /** Fait en ajout seul : insertion unique, jamais de mise à jour. */
  appendOnly?: boolean;
}

/** Instantané publié par un domaine → projection (A-54). Une entrée par type d'événement. */
export const PROJECTIONS = {
  'tontine.snapshot': {
    model: 'rptTontine',
    bigint: ['contributionMinor'],
    dates: ['createdAt', 'startedAt', 'completedAt', 'archivedUntil'],
  },
  'tontine.cycle.snapshot': {
    model: 'rptCycle',
    bigint: ['expectedMinor', 'collectedMinor', 'payoutMinor'],
    dates: ['dueDate', 'completedAt'],
  },
  'tontine.contribution.snapshot': {
    model: 'rptContribution',
    bigint: ['amountMinor', 'penaltyMinor'],
    dates: ['dueDate', 'paidAt'],
  },
  'tontine.membership.snapshot': { model: 'rptTontineMember', dates: ['joinedAt'] },
  'wallet.snapshot': { model: 'rptWallet', bigint: ['balanceMinor', 'blockedMinor'] },
  'wallet.movement.recorded': {
    model: 'rptWalletMovement',
    bigint: ['amountMinor'],
    dates: ['createdAt'],
    appendOnly: true,
  },
  'transaction.snapshot': {
    model: 'rptTransaction',
    bigint: ['amountMinor'],
    dates: ['createdAt', 'completedAt'],
  },
  'reconciliation.report.snapshot': {
    model: 'rptReconciliation',
    dates: ['businessDate', 'createdAt'],
  },
  'payment.snapshot': {
    model: 'rptPayment',
    bigint: ['amountMinor', 'feeMinor'],
    dates: ['createdAt', 'completedAt'],
  },
  'member.snapshot': { model: 'rptMember' },
  'kyc.request.snapshot': { model: 'rptKycRequest', dates: ['submittedAt'] },
  'kyc.aml.match.snapshot': { model: 'rptAmlMatch', dates: ['createdAt'] },
  'compliance.violation.recorded': {
    model: 'rptViolation',
    dates: ['createdAt'],
    appendOnly: true,
  },
  'compliance.case.snapshot': { model: 'rptCase', dates: ['openedAt', 'closedAt'] },
} as const satisfies Partial<Record<EventType, Spec>>;

export type ProjectedEvent = keyof typeof PROJECTIONS;

/**
 * Projections du reporting (étape 6, A-54) : alimentées uniquement par les instantanés d'état
 * publiés par les domaines. Idempotent et insensible au désordre : une ligne n'est remplacée que
 * par un instantané de version supérieure ou égale ; une suppression n'efface qu'un état plus ancien.
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(type: ProjectedEvent, payload: Record<string, unknown>): Promise<void> {
    const spec: Spec = PROJECTIONS[type];
    const delegate = this.prisma[spec.model] as unknown as ProjectionDelegate;
    await (spec.appendOnly ? applyRecorded : applySnapshot)(delegate, spec, payload);
  }
}

/** Abonnement du reporting aux instantanés (un consommateur par type, idempotent). */
@Injectable()
export class ProjectionConsumers {
  constructor(private readonly projections: ProjectionService) {}

  private on(e: EventEnvelope, type: ProjectedEvent) {
    return this.projections.apply(type, e.payload as Record<string, unknown>);
  }

  @OnEvent('tontine.snapshot', { consumer: 'reporting.projection' })
  tontine(e: EventEnvelope<'tontine.snapshot'>) {
    return this.on(e, 'tontine.snapshot');
  }
  @OnEvent('tontine.cycle.snapshot', { consumer: 'reporting.projection' })
  cycle(e: EventEnvelope<'tontine.cycle.snapshot'>) {
    return this.on(e, 'tontine.cycle.snapshot');
  }
  @OnEvent('tontine.contribution.snapshot', { consumer: 'reporting.projection' })
  contribution(e: EventEnvelope<'tontine.contribution.snapshot'>) {
    return this.on(e, 'tontine.contribution.snapshot');
  }
  @OnEvent('tontine.membership.snapshot', { consumer: 'reporting.projection' })
  membership(e: EventEnvelope<'tontine.membership.snapshot'>) {
    return this.on(e, 'tontine.membership.snapshot');
  }
  @OnEvent('wallet.snapshot', { consumer: 'reporting.projection' })
  wallet(e: EventEnvelope<'wallet.snapshot'>) {
    return this.on(e, 'wallet.snapshot');
  }
  @OnEvent('wallet.movement.recorded', { consumer: 'reporting.projection' })
  movement(e: EventEnvelope<'wallet.movement.recorded'>) {
    return this.on(e, 'wallet.movement.recorded');
  }
  @OnEvent('transaction.snapshot', { consumer: 'reporting.projection' })
  transaction(e: EventEnvelope<'transaction.snapshot'>) {
    return this.on(e, 'transaction.snapshot');
  }
  @OnEvent('reconciliation.report.snapshot', { consumer: 'reporting.projection' })
  reconciliation(e: EventEnvelope<'reconciliation.report.snapshot'>) {
    return this.on(e, 'reconciliation.report.snapshot');
  }
  @OnEvent('payment.snapshot', { consumer: 'reporting.projection' })
  payment(e: EventEnvelope<'payment.snapshot'>) {
    return this.on(e, 'payment.snapshot');
  }
  @OnEvent('member.snapshot', { consumer: 'reporting.projection' })
  member(e: EventEnvelope<'member.snapshot'>) {
    return this.on(e, 'member.snapshot');
  }
  @OnEvent('kyc.request.snapshot', { consumer: 'reporting.projection' })
  kycRequest(e: EventEnvelope<'kyc.request.snapshot'>) {
    return this.on(e, 'kyc.request.snapshot');
  }
  @OnEvent('kyc.aml.match.snapshot', { consumer: 'reporting.projection' })
  amlMatch(e: EventEnvelope<'kyc.aml.match.snapshot'>) {
    return this.on(e, 'kyc.aml.match.snapshot');
  }
  @OnEvent('compliance.violation.recorded', { consumer: 'reporting.projection' })
  violation(e: EventEnvelope<'compliance.violation.recorded'>) {
    return this.on(e, 'compliance.violation.recorded');
  }
  @OnEvent('compliance.case.snapshot', { consumer: 'reporting.projection' })
  complianceCase(e: EventEnvelope<'compliance.case.snapshot'>) {
    return this.on(e, 'compliance.case.snapshot');
  }
}
