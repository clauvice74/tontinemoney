import { type MemberStatus } from '@tontine/contracts';

/** Déclencheurs de transition du statut membre (US-2.6, P2 §2.3). */
export type MemberTrigger =
  | 'profile.completed'
  | 'kyc.submitted'
  | 'kyc.review.required'
  | 'kyc.verified'
  | 'kyc.rejected'
  | 'kyc.duplicate.detected'
  | 'fraud.user.flagged'
  | 'compliance.user.suspended'
  | 'admin.suspend'
  | 'admin.reactivate'
  | 'duplicate.dismissed';

const ALL: MemberStatus[] = [
  'PENDING',
  'KYC_REQUIRED',
  'KYC_IN_REVIEW',
  'KYC_REJECTED',
  'ACTIVE',
  'SUSPENDED',
  'PENDING_REVIEW',
];
const allBut = (...excluded: MemberStatus[]) => ALL.filter((s) => !excluded.includes(s));

/** Matrice : déclencheur → (statuts d'origine autorisés, statut cible). */
export const MEMBER_TRANSITIONS: Record<MemberTrigger, { from: MemberStatus[]; to: MemberStatus }> =
  {
    'profile.completed': { from: ['PENDING'], to: 'KYC_REQUIRED' },
    'kyc.submitted': { from: ['KYC_REQUIRED', 'KYC_REJECTED'], to: 'KYC_IN_REVIEW' },
    'kyc.review.required': { from: ['KYC_REQUIRED'], to: 'KYC_IN_REVIEW' },
    'kyc.verified': { from: ['KYC_REQUIRED', 'KYC_IN_REVIEW'], to: 'ACTIVE' },
    'kyc.rejected': { from: ['KYC_IN_REVIEW'], to: 'KYC_REJECTED' },
    'kyc.duplicate.detected': { from: allBut('SUSPENDED', 'PENDING_REVIEW'), to: 'PENDING_REVIEW' },
    'fraud.user.flagged': { from: allBut('SUSPENDED'), to: 'SUSPENDED' },
    'compliance.user.suspended': { from: allBut('SUSPENDED'), to: 'SUSPENDED' },
    'admin.suspend': { from: allBut('SUSPENDED'), to: 'SUSPENDED' },
    'admin.reactivate': { from: ['SUSPENDED'], to: 'ACTIVE' },
    'duplicate.dismissed': { from: ['PENDING_REVIEW'], to: 'KYC_IN_REVIEW' },
  };

export type TransitionResult = { ok: true; to: MemberStatus } | { ok: false; reason: string };

/** Fonction pure : calcule la transition ou indique pourquoi elle est invalide. */
export function transition(current: MemberStatus, trigger: MemberTrigger): TransitionResult {
  const rule = MEMBER_TRANSITIONS[trigger];
  if (!rule.from.includes(current)) {
    return { ok: false, reason: `${trigger} ignoré : statut ${current} incompatible` };
  }
  return { ok: true, to: rule.to };
}
