'use client';

import {
  CONTRIBUTION_STATUS_LABELS,
  CYCLE_STATUS_LABELS,
  DRAW_MODE_LABELS,
  FREQUENCY_LABELS,
  INCOMPLETE_POLICY_LABELS,
  INVITATION_STATUS_LABELS,
  KYC_LEVEL_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  MOVEMENT_CONTEXT_LABELS,
  TONTINE_STATUS_LABELS,
  WEEKDAY_LABELS,
  WEEK_OF_MONTH_LABELS,
} from '../labels';
import { useI18n } from './index';

/** Libellés de statuts et d'énumérations : français dans `labels.ts`, anglais ici. */
const FR = {
  tontineStatus: TONTINE_STATUS_LABELS,
  contributionStatus: CONTRIBUTION_STATUS_LABELS,
  cycleStatus: CYCLE_STATUS_LABELS,
  frequency: FREQUENCY_LABELS,
  drawMode: DRAW_MODE_LABELS,
  incompletePolicy: INCOMPLETE_POLICY_LABELS,
  weekday: WEEKDAY_LABELS,
  weekOfMonth: WEEK_OF_MONTH_LABELS,
  membershipStatus: MEMBERSHIP_STATUS_LABELS,
  invitationStatus: INVITATION_STATUS_LABELS,
  kycLevel: KYC_LEVEL_LABELS,
  movementContext: MOVEMENT_CONTEXT_LABELS,
};

type LabelSets = { [K in keyof typeof FR]: Record<string, string> };

const EN: LabelSets = {
  tontineStatus: {
    DRAFT: 'Draft',
    READY: 'Ready',
    ACTIVE: 'Active',
    PAUSED: 'Paused',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  },
  contributionStatus: {
    PENDING: 'Due',
    PAID: 'Paid',
    LATE: 'Late',
    PAID_LATE: 'Paid late',
    DEFAULTED: 'Defaulted',
  },
  cycleStatus: {
    PENDING: 'Upcoming',
    IN_PROGRESS: 'In progress',
    PAYOUT_PENDING: 'Payout pending',
    PAYOUT_PROCESSING: 'Payout in progress',
    COMPLETED: 'Completed',
  },
  frequency: {
    WEEKLY: 'Weekly',
    BIWEEKLY: 'Every two weeks',
    MONTHLY: 'Monthly',
    BIMONTHLY: 'Twice a month (15th and last day)',
  },
  drawMode: { RANDOM: 'Random draw', FIXED_ORDER: 'Fixed order', PRIORITY_NEED: 'Priority need' },
  incompletePolicy: {
    POSTPONE: 'Postpone the payout until all have paid',
    PARTIAL_PAYOUT: 'Pay the beneficiary what was collected',
  },
  weekday: {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  },
  weekOfMonth: {
    '1': '1st week',
    '2': '2nd week',
    '3': '3rd week',
    '4': '4th week',
    '-1': 'Last week',
  },
  membershipStatus: {
    PENDING_ACTIVATION: 'Awaiting activation',
    PENDING_APPROVAL: 'Awaiting approval',
    ACTIVE: 'Active',
    SUSPENDED: 'Suspended',
    REMOVED: 'Removed',
    REJECTED: 'Rejected',
  },
  invitationStatus: {
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    DECLINED: 'Declined',
    EXPIRED: 'Expired',
    REVOKED: 'Revoked',
  },
  kycLevel: { NONE: 'None', TIER_1: 'Level 1', TIER_2: 'Level 2', TIER_3: 'Level 3' },
  movementContext: {
    DEPOSIT: 'Deposit',
    WITHDRAWAL: 'Withdrawal',
    TRANSFER: 'Transfer',
    TONTINE_CONTRIBUTION: 'Contribution',
    TONTINE_PAYOUT: 'Tontine payout',
    PENALTY: 'Penalty',
    ENTRY_FEE: 'Entry fee',
    COLLATION: 'Collation',
    REFUND: 'Refund',
    REVERSAL: 'Reversal',
  },
};

/** Libellés dans la langue courante ; une valeur inconnue en anglais retombe sur le français. */
export function useLabels(): LabelSets {
  const { locale } = useI18n();
  if (locale === 'fr') return FR;
  const out = {} as LabelSets;
  for (const k of Object.keys(FR) as Array<keyof LabelSets>) out[k] = { ...FR[k], ...EN[k] };
  return out;
}
