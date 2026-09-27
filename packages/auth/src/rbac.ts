import { type PlatformRole } from '@tontine/contracts';

/**
 * Matrice RBAC de référence (docs/security-model.md §2).
 * Le contrôle de rôle est TOUJOURS complété par un contrôle de propriété de la ressource.
 */
export const PERMISSIONS = [
  'platform.tontine-admins.create',
  'platform.access-requests.decide',
  'platform.users.unlock',
  'platform.members.read',
  'platform.members.suspend',
  'platform.fraud.flag',
  'platform.jobs.run',
  'platform.outbox.inspect',
  'platform.wallets.manage',
  'platform.payments.refund',
  'platform.reconciliation.view',
  'platform.reports.view',
  'platform.tontines.pause',
  'compliance.rules.manage',
  'compliance.cases.manage',
  'compliance.validate',
  'kyc.review',
  'kyc.documents.read',
  'tontine.create',
  'tontine.manage',
  'tontine.members.register',
  'member.self',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MEMBER_PERMS: Permission[] = ['member.self', 'tontine.create'];

export const ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  TONTINE_ADMIN: [...MEMBER_PERMS, 'tontine.manage', 'tontine.members.register'],
  MEMBER: [...MEMBER_PERMS, 'tontine.manage', 'tontine.members.register'],
  KYC_AGENT: [
    'member.self',
    'platform.members.read',
    'compliance.cases.manage',
    'kyc.review',
    'kyc.documents.read',
  ],
};

export function can(role: PlatformRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Rôles considérés comme administrateurs plateforme pour l'accès aux données d'autrui. */
export function isPlatformStaff(role: PlatformRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'KYC_AGENT';
}
