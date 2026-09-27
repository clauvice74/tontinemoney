import { type ConfigurationKey, type ConfigurationValues } from '@tontine/contracts';
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

/** Compte plateforme : rôle et statut (implémenté par le domaine Auth). */
export interface AccountSnapshot {
  id: string;
  role: string;
  status: string;
}

/** Lecture courte des comptes pour les autres domaines (ex. assignation d'un dossier). */
export interface AccountDirectoryPort {
  account(userId: string): Promise<AccountSnapshot | null>;
  /** Comptes par statut et demandes d'accès en attente (tableau de bord administrateur). */
  statistics(): Promise<{ byStatus: Record<string, number>; pendingAccessRequests: number }>;
}

export const ACCOUNT_DIRECTORY = Symbol('ACCOUNT_DIRECTORY');

/**
 * Cumuls des opérations d'un membre (implémenté par Transaction Service, étape 6, A-54) :
 * plafonds journaliers et mensuels de la conformité. Lecture synchrone exacte — une projection
 * asynchrone laisserait passer des opérations rapprochées au-delà du plafond.
 */
export interface TransactionTotalsPort {
  /** Somme des transactions VALIDATED ou COMPLETED initiées par le membre depuis `since`. */
  initiatedTotal(
    memberId: string,
    currency: string,
    types: readonly string[],
    since: Date,
  ): Promise<bigint>;
}

export const TRANSACTION_TOTALS = Symbol('TRANSACTION_TOTALS');

/** Lecture exacte d'un wallet membre (implémenté par Wallet Service, étape 6, A-54). */
export interface WalletQueryPort {
  /** Solde du wallet du membre, null s'il n'en a pas. */
  memberBalance(memberId: string): Promise<bigint | null>;
}

export const WALLET_QUERY = Symbol('WALLET_QUERY');

/**
 * Paramètres modifiables à chaud (propriété d'admin-service, A-50). Valeur en cache court,
 * invalidée par l'événement `admin.configuration.updated` ; défaut de la définition si absent.
 */
export interface ConfigurationPort {
  get<K extends ConfigurationKey>(key: K): Promise<ConfigurationValues[K]>;
}

export const CONFIGURATION = Symbol('CONFIGURATION');

/**
 * Communication (comment envoyer, A-51) : résolution de l'adresse, fournisseur du canal, limite
 * anti-spam SMS, journal de livraison. Une tentative par appel ; la politique de réessai, la
 * file d'attente et le repli de canal appartiennent au domaine Notifications. Appel synchrone
 * en processus unique ; paire d'événements communication.requested / communication.result
 * après l'introduction de Kafka (étape 3).
 */
export interface CommunicationRequest {
  notificationId: string;
  recipientId: string;
  channel: 'SMS' | 'EMAIL' | 'PUSH';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  subject: string;
  body: string;
}

export type CommunicationResult =
  | { status: 'SENT'; providerRef: string | null }
  /** Limite anti-spam atteinte : définitif pour ce message. */
  | { status: 'THROTTLED'; reason: string }
  /** `retryable: false` : aucune adresse pour ce canal, ou refus définitif du fournisseur. */
  | { status: 'FAILED'; retryable: boolean; reason: string };

/**
 * Envoi à une adresse explicite (messages contenant un secret : activation, OTP, réinitialisation),
 * sans limite anti-spam ; le destinataire n'a pas forcément encore de profil membre.
 */
export interface DirectDelivery {
  channel: 'SMS' | 'EMAIL';
  to: string;
  subject: string;
  body: string;
  notificationId?: string | null;
  recipientId?: string | null;
}

export interface CommunicationPort {
  send(request: CommunicationRequest): Promise<CommunicationResult>;
  deliver(request: DirectDelivery): Promise<CommunicationResult>;
}

export const COMMUNICATION = Symbol('COMMUNICATION');
