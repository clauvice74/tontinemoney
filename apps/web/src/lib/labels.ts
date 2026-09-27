import type { BadgeVariant } from '@tontine/ui';

/** Libellés français des énumérations partagées. */

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super-administrateur',
  TONTINE_ADMIN: 'Administrateur de tontine',
  MEMBER: 'Membre',
  KYC_AGENT: 'Agent KYC',
  COMPLIANCE_AGENT: 'Agent conformité',
  ADMIN: 'Administrateur',
};

export const USER_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: 'En attente de validation',
  PENDING_ACTIVATION: 'En attente d’activation',
  ACTIVE: 'Actif',
  ACTIVE_PENDING_KYC: 'Actif — KYC à compléter',
  SUSPENDED: 'Suspendu',
  REJECTED: 'Refusé',
  EXPIRED: 'Expiré',
  INACTIVE: 'Inactif',
};

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  KYC_REQUIRED: 'KYC requis',
  KYC_IN_REVIEW: 'KYC en revue',
  KYC_REJECTED: 'KYC refusé',
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  PENDING_REVIEW: 'En revue',
};

export const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  PENDING_ACTIVATION: 'Activation en attente',
  PENDING_APPROVAL: 'Validation en attente',
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  REMOVED: 'Retiré',
  REJECTED: 'Refusé',
};

export const KYC_LEVEL_LABELS: Record<string, string> = {
  NONE: 'Aucun',
  TIER_1: 'Niveau 1',
  TIER_2: 'Niveau 2',
  TIER_3: 'Niveau 3',
};

export const KYC_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Soumis',
  PROCESSING: 'En cours de traitement',
  VERIFIED: 'Vérifié',
  REVIEW_REQUIRED: 'Revue manuelle',
  REJECTED: 'Refusé',
  EXPIRED: 'Expiré',
  SUPPLEMENT_REQUESTED: 'Compléments demandés',
};

export const KYC_DOCUMENT_LABELS: Record<string, string> = {
  CNI: 'Carte nationale d’identité',
  PASSPORT: 'Passeport',
  DRIVING_LICENSE: 'Permis de conduire',
  NIN_SLIP: 'NIN Slip',
  VOTER_CARD: 'Carte d’électeur',
  RESIDENCE_PERMIT: 'Titre de séjour',
  PROOF_OF_ADDRESS: 'Justificatif de domicile',
  INCOME_DECLARATION: 'Déclaration de revenus',
};

export const KYC_REJECT_LABELS: Record<string, string> = {
  DOCUMENT_ILLISIBLE: 'Document illisible',
  DOCUMENT_EXPIRE: 'Document expiré',
  DOCUMENT_FALSIFIE: 'Document falsifié',
  FACE_MATCH_ECHOUE: 'Correspondance faciale échouée',
  DOUBLON_CONFIRME: 'Doublon confirmé',
  AML_MATCH_CONFIRME: 'Correspondance AML confirmée',
  INFORMATION_INCOHERENTE: 'Informations incohérentes',
  TYPE_DOCUMENT_NON_ACCEPTE: 'Type de document non accepté',
  AUTRE: 'Autre',
};

export const KYC_STEP_LABELS: Record<string, string> = {
  QUALITY: 'Qualité',
  OCR: 'Lecture OCR',
  DOCUMENT_VALIDATION: 'Validation du document',
  FACE_MATCH: 'Correspondance faciale',
  DUPLICATE: 'Doublons',
  AML: 'AML / sanctions',
};

export const TONTINE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  READY: 'Prête',
  ACTIVE: 'Active',
  PAUSED: 'En pause',
  COMPLETED: 'Terminée',
  CANCELLED: 'Annulée',
};

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: 'Hebdomadaire',
  BIWEEKLY: 'Toutes les deux semaines',
  MONTHLY: 'Mensuelle',
  BIMONTHLY: 'Bimensuelle (le 15 et le dernier jour du mois)',
};

export const WEEKDAY_LABELS: Record<string, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

export const WEEK_OF_MONTH_LABELS: Record<string, string> = {
  '1': '1re semaine',
  '2': '2e semaine',
  '3': '3e semaine',
  '4': '4e semaine',
  '-1': 'Dernière semaine',
};

export const DRAW_MODE_LABELS: Record<string, string> = {
  RANDOM: 'Tirage aléatoire',
  FIXED_ORDER: 'Ordre fixe',
  PRIORITY_NEED: 'Besoin prioritaire',
};

export const INCOMPLETE_POLICY_LABELS: Record<string, string> = {
  POSTPONE: 'Reporter le versement jusqu’à complétude',
  PARTIAL_PAYOUT: 'Verser partiellement au bénéficiaire',
};

export const CONTRIBUTION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'À payer',
  PAID: 'Payée',
  LATE: 'En retard',
  PAID_LATE: 'Payée en retard',
  DEFAULTED: 'Défaut',
};

export const INVITATION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  ACCEPTED: 'Acceptée',
  DECLINED: 'Refusée',
  REVOKED: 'Révoquée',
  EXPIRED: 'Expirée',
};

export const INVITATION_CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  PHONE: 'Téléphone',
  LINK: 'Lien partageable',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  COMPLETED: 'Terminé',
  FAILED: 'Échoué',
  EXPIRED: 'Expiré',
  CANCELLED: 'Annulé',
  REFUNDED: 'Remboursé',
};

export const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  VALIDATED: 'Validée',
  COMPLETED: 'Terminée',
  FAILED: 'Échouée',
  REJECTED: 'Rejetée',
  REVERSED: 'Annulée (contre-passée)',
  REFUNDED: 'Remboursée',
};

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  CREDIT: 'Crédit',
  DEBIT: 'Débit',
  HOLD: 'Blocage',
  RELEASE: 'Déblocage',
};

export const MOVEMENT_CONTEXT_LABELS: Record<string, string> = {
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  TRANSFER: 'Transfert',
  TONTINE_CONTRIBUTION: 'Cotisation',
  TONTINE_PAYOUT: 'Versement tontine',
  PENALTY: 'Pénalité',
  ENTRY_FEE: 'Droit d’entrée',
  COLLATION: 'Collation',
  REFUND: 'Remboursement',
  REVERSAL: 'Contre-passation',
};

export const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  SECURITY: 'Sécurité',
  ACCOUNT: 'Compte',
  TONTINE: 'Tontines',
  PAYMENT: 'Paiements',
  WALLET: 'Portefeuille',
  KYC: 'Vérification d’identité',
  ADMIN: 'Administration',
  MESSAGE: 'Messages',
};

export const NOTIFICATION_CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS',
  EMAIL: 'Email',
  PUSH: 'Notification push',
  IN_APP: 'Dans l’application',
};

export const ACCESS_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  APPROVED: 'Acceptée',
  REJECTED: 'Refusée',
  EXPIRED: 'Expirée',
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  MAIN: 'Compte principal',
  SOLIDARITY: 'Caisse de solidarité',
  SAVINGS: 'Épargne',
  LOAN: 'Prêts',
};

export const MESSAGE_TEMPLATE_LABELS: Record<string, string> = {
  REMINDER: 'Rappel de cotisation',
  ANNOUNCEMENT: 'Annonce',
  INFORMATION: 'Information',
  CUSTOM: 'Message libre',
};

export const REPORT_KIND_LABELS: Record<string, string> = {
  CYCLE: 'Rapport de cycle',
  MONTHLY: 'Rapport mensuel',
  ANNUAL: 'Rapport annuel',
  CONTRIBUTIONS: 'Cotisations',
  PENALTIES: 'Pénalités',
  FINAL: 'Rapport de clôture',
};

export const GENDER_LABELS: Record<string, string> = {
  M: 'Homme',
  F: 'Femme',
  OTHER: 'Autre',
  UNDISCLOSED: 'Ne souhaite pas répondre',
};

export const OPERATION_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  TRANSFER: 'Transfert',
  TONTINE_CONTRIBUTION: 'Cotisation',
  TONTINE_PAYOUT: 'Versement',
  TONTINE_CREATION: 'Création de tontine',
  TONTINE_JOIN: 'Adhésion à une tontine',
};

export const RULE_TYPE_LABELS: Record<string, string> = {
  DAILY_LIMIT: 'Plafond journalier',
  MONTHLY_LIMIT: 'Plafond mensuel',
  WALLET_LIMIT: 'Plafond du portefeuille',
  KYC_MIN_LEVEL: 'Niveau KYC minimum',
  TONTINE_ALLOWED: 'Tontines autorisées',
  OPERATION_FORBIDDEN: 'Opération interdite',
};

export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

/** Variante visuelle d'un badge selon le statut. */
export function statusVariant(status: string | null | undefined): BadgeVariant {
  switch (status) {
    case 'ACTIVE':
    case 'PAID':
    case 'COMPLETED':
    case 'VERIFIED':
    case 'APPROVED':
    case 'ACCEPTED':
    case 'SUCCESS':
    case 'VALIDATED':
    case 'PASS':
      return 'success';
    case 'PENDING':
    case 'PENDING_ACTIVATION':
    case 'PENDING_APPROVAL':
    case 'PROCESSING':
    case 'SUBMITTED':
    case 'KYC_IN_REVIEW':
    case 'READY':
    case 'IN_PROGRESS':
    case 'DRAFT':
      return 'info';
    case 'LATE':
    case 'PAID_LATE':
    case 'REVIEW_REQUIRED':
    case 'SUPPLEMENT_REQUESTED':
    case 'KYC_REQUIRED':
    case 'PAUSED':
    case 'PENDING_REVIEW':
    case 'ACTIVE_PENDING_KYC':
    case 'REVIEW':
    case 'PAYOUT_PENDING':
      return 'warning';
    case 'SUSPENDED':
    case 'REJECTED':
    case 'FAILED':
    case 'DEFAULTED':
    case 'KYC_REJECTED':
    case 'DENIED':
    case 'FAILURE':
    case 'FAIL':
    case 'LOCKED':
    case 'DEAD':
      return 'destructive';
    default:
      return 'muted';
  }
}
