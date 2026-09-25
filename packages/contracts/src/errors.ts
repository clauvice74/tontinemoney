/**
 * Catalogue des codes d'erreur de l'API (Problem Details, RFC 9457).
 * `status` = code HTTP ; `title` = libellé français par défaut.
 */
export const ERROR_CATALOG = {
  VALIDATION_FAILED: { status: 400, title: 'Données invalides' },
  MISSING_IDENTIFIER: { status: 400, title: 'Au moins un identifiant requis' },
  INVALID_PHONE: { status: 400, title: 'Format téléphone invalide' },
  WEAK_PASSWORD: { status: 400, title: 'Le mot de passe ne respecte pas les critères' },
  PASSWORD_REUSED: { status: 400, title: 'Le mot de passe doit être différent des 5 derniers' },
  REASON_REQUIRED: { status: 400, title: 'Le motif est obligatoire' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, title: 'En-tête Idempotency-Key requis' },
  INVALID_CREDENTIALS: { status: 401, title: 'Identifiants incorrects' },
  UNAUTHENTICATED: { status: 401, title: 'Authentification requise' },
  INVALID_TOKEN: { status: 401, title: 'Jeton invalide' },
  MFA_REQUIRED: { status: 401, title: 'Code MFA requis' },
  INVALID_MFA_CODE: { status: 401, title: 'Code MFA invalide' },
  INVALID_OTP: { status: 401, title: 'Code invalide' },
  INVALID_SIGNATURE: { status: 401, title: 'Signature invalide' },
  FORBIDDEN: { status: 403, title: 'Accès refusé' },
  NAME_LOCKED_AFTER_KYC: { status: 403, title: 'Modification interdite après KYC' },
  NOT_FOUND: { status: 404, title: 'Ressource introuvable' },
  EMAIL_ALREADY_USED: { status: 409, title: 'Email déjà utilisé' },
  PHONE_ALREADY_USED: { status: 409, title: 'Téléphone déjà utilisé' },
  MEMBER_ALREADY_EXISTS: { status: 409, title: 'Ce membre existe déjà' },
  VERSION_CONFLICT: { status: 409, title: 'Profil modifié entre-temps' },
  DUPLICATE_NAME: { status: 409, title: 'Nom déjà utilisé' },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, title: 'Requête identique en cours de traitement' },
  CONFLICT: { status: 409, title: 'Conflit' },
  TOKEN_EXPIRED: { status: 410, title: 'Lien expiré, refaites une demande' },
  TOKEN_ALREADY_USED: { status: 410, title: 'Lien déjà utilisé' },
  OTP_EXPIRED: { status: 410, title: 'Code expiré, demandez un renvoi' },
  FILE_TOO_LARGE: { status: 413, title: 'Fichier trop volumineux' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Type de fichier non accepté' },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    title: 'Clé d’idempotence réutilisée avec une requête différente',
  },
  INSUFFICIENT_FUNDS: { status: 422, title: 'Solde insuffisant' },
  CURRENCY_MISMATCH: { status: 422, title: 'Devises incompatibles' },
  WALLET_NOT_OPERATIONAL: { status: 422, title: 'Portefeuille indisponible pour cette opération' },
  INVALID_STATE_TRANSITION: { status: 422, title: 'Transition de statut invalide' },
  COMPLIANCE_VIOLATION: { status: 422, title: 'Opération non conforme' },
  KYC_LEVEL_INSUFFICIENT: { status: 422, title: 'Niveau KYC insuffisant' },
  MEMBER_NOT_ELIGIBLE: { status: 422, title: 'Membre non éligible' },
  BUSINESS_RULE_VIOLATION: { status: 422, title: 'Règle métier non respectée' },
  KYC_REQUEST_IN_PROGRESS: { status: 422, title: 'Un dossier KYC est déjà en cours' },
  TONTINE_FULL: { status: 422, title: 'Nombre maximum de membres atteint' },
  PAYOUT_NOT_READY: { status: 422, title: 'Paiement au bénéficiaire impossible pour le moment' },
  ACCOUNT_LOCKED: { status: 423, title: 'Compte temporairement verrouillé' },
  OTP_LOCKED: { status: 423, title: 'Trop de tentatives, réessayez dans 15 minutes' },
  RATE_LIMITED: { status: 429, title: 'Trop de requêtes' },
  PROVIDER_UNAVAILABLE: { status: 503, title: 'Fournisseur indisponible' },
  INTERNAL_ERROR: { status: 500, title: 'Erreur interne' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  correlationId?: string;
  errors?: Array<{ path: string; message: string }>;
  [extra: string]: unknown;
}

export function problemType(code: ErrorCode): string {
  return `https://docs.tontinemoney.local/errors/${code.toLowerCase().replace(/_/g, '-')}`;
}
