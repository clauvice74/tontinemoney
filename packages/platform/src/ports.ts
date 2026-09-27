import { type TxClient } from '@tontine/database';

/**
 * Ports inter-domaines partagés (noyau). Les implémentations sont fournies par le domaine
 * propriétaire sous forme de providers globaux ; les consommateurs ne dépendent que de l'interface.
 */

/** Accès en lecture aux tontines (implémenté par le domaine Tontines). */
export interface TontineAccessPort {
  describe(
    tontineId: string,
  ): Promise<{ id: string; name: string; currency: string; status: string } | null>;
  adminIds(tontineId: string): Promise<string[]>;
  participantIds(tontineId: string): Promise<string[]>;
  isAdmin(tontineId: string, userId: string): Promise<boolean>;
  isParticipant(tontineId: string, userId: string): Promise<boolean>;
  /** Tontines actives d'un utilisateur (claim JWT `tontineIds`). */
  tontineIdsOf(userId: string): Promise<string[]>;
  /** Vrai si deux utilisateurs partagent au moins une tontine. */
  shareTontine(userA: string, userB: string): Promise<boolean>;
  /** Tontine ciblée par un code d'invitation partageable (US-1.3), sinon null. */
  resolveInvitationCode(code: string): Promise<string | null>;
  /** Tontine dont le nom correspond exactement (unique) — demande de compte US-1.3. */
  findByExactName(name: string): Promise<string | null>;
}

export const TONTINE_ACCESS = Symbol('TONTINE_ACCESS');

/** Instantané d'éligibilité d'un membre (implémenté par le domaine Membres). */
export interface MemberSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  kycLevel: 'NONE' | 'TIER_1' | 'TIER_2' | 'TIER_3';
  complianceStatus: string;
  country: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  language: string;
}

export interface MemberQueryPort {
  snapshot(memberId: string): Promise<MemberSnapshot | null>;
  snapshots(memberIds: string[]): Promise<MemberSnapshot[]>;
  findByIdentifier(identifier: string): Promise<MemberSnapshot | null>;
  /** Membres dans un statut donné (ex. screening AML quotidien des membres ACTIVE). */
  snapshotsByStatus(status: string): Promise<MemberSnapshot[]>;
  /** Changements de pays saisis par le membre depuis `since` (US-9.4, détection d'abus). */
  countryChangesSince(memberId: string, since: Date): Promise<number>;
}

export const MEMBER_QUERY = Symbol('MEMBER_QUERY');

const KYC_ORDER = ['NONE', 'TIER_1', 'TIER_2', 'TIER_3'];
export function kycAtLeast(level: string, min: string): boolean {
  return KYC_ORDER.indexOf(level) >= KYC_ORDER.indexOf(min);
}

/**
 * Délégation de création de tontine (US-1.1 / A-04), implémentée par le domaine Auth :
 * un admin créé par le super-admin peut créer UNE tontine sans le niveau KYC TIER_3.
 */
export interface AdminDelegationPort {
  /** Nom de tontine délégué encore disponible, sinon null. */
  pendingDelegation(userId: string): Promise<string | null>;
  /** Consomme la délégation dans la transaction appelante ; faux si déjà utilisée. */
  consumeDelegation(tx: TxClient, userId: string): Promise<boolean>;
}

export const ADMIN_DELEGATION = Symbol('ADMIN_DELEGATION');
