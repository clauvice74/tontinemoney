import type { PlatformRole } from '@tontine/contracts';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Correspondance exacte du chemin pour l'état actif. */
  exact?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export type NavIcon =
  | 'dashboard'
  | 'wallet'
  | 'tontines'
  | 'bell'
  | 'id'
  | 'user'
  | 'shield'
  | 'plus'
  | 'settings'
  | 'users'
  | 'inbox'
  | 'scale'
  | 'alert'
  | 'receipt'
  | 'card'
  | 'refresh'
  | 'clock'
  | 'queue'
  | 'log'
  | 'scan'
  | 'copy'
  | 'search'
  | 'mail';

export const isDev = process.env.NODE_ENV !== 'production';

/** Rôles disposant d'un espace membre (profil, portefeuille, tontines). */
export function hasMemberSpace(role: PlatformRole): boolean {
  return role === 'MEMBER' || role === 'TONTINE_ADMIN';
}

/** Page d'accueil après connexion selon le rôle. */
export function homeFor(role: PlatformRole): string {
  if (role === 'SUPER_ADMIN') return '/admin';
  if (role === 'KYC_AGENT') return '/kyc-review';
  return '/dashboard';
}

export function buildNavigation(
  role: PlatformRole,
  adminTontines: Array<{ id: string; name: string }>,
): NavSection[] {
  const sections: NavSection[] = [];
  if (hasMemberSpace(role)) {
    sections.push({
      title: 'Mon espace',
      items: [
        { href: '/dashboard', label: 'Tableau de bord', icon: 'dashboard' },
        { href: '/wallet', label: 'Portefeuille', icon: 'wallet' },
        { href: '/tontines', label: 'Mes tontines', icon: 'tontines', exact: true },
        { href: '/notifications', label: 'Notifications', icon: 'bell' },
        { href: '/kyc', label: 'Vérification d’identité', icon: 'id' },
        { href: '/profile', label: 'Profil', icon: 'user' },
        { href: '/security', label: 'Sécurité', icon: 'shield' },
      ],
    });
    sections.push({
      title: 'Administration de tontine',
      items: [
        { href: '/tontines/new', label: 'Créer une tontine', icon: 'plus' },
        ...adminTontines.map((t) => ({
          href: `/tontines/${t.id}/admin`,
          label: t.name,
          icon: 'settings' as const,
        })),
      ],
    });
  }
  if (role === 'KYC_AGENT' || role === 'SUPER_ADMIN') {
    sections.push({
      title: 'Revue KYC',
      items: [
        { href: '/kyc-review', label: 'File de revue', icon: 'scan', exact: true },
        { href: '/kyc-review/duplicates', label: 'Doublons', icon: 'copy' },
        { href: '/kyc-review/aml', label: 'Correspondances AML', icon: 'search' },
      ],
    });
  }
  if (role === 'SUPER_ADMIN') {
    sections.push({
      title: 'Plateforme',
      items: [
        { href: '/admin', label: 'Vue d’ensemble', icon: 'dashboard', exact: true },
        { href: '/admin/tontine-admins/new', label: 'Créer un admin', icon: 'plus' },
        { href: '/admin/access-requests', label: 'Demandes d’accès', icon: 'inbox' },
        { href: '/admin/users', label: 'Utilisateurs', icon: 'users' },
        { href: '/admin/members', label: 'Membres', icon: 'user' },
        { href: '/admin/tontines', label: 'Tontines', icon: 'tontines' },
        { href: '/admin/compliance', label: 'Règles de conformité', icon: 'scale', exact: true },
        { href: '/admin/compliance/violations', label: 'Violations', icon: 'alert' },
        { href: '/admin/fraud', label: 'Signalement de fraude', icon: 'alert' },
        { href: '/admin/transactions', label: 'Transactions', icon: 'receipt' },
        { href: '/admin/payments', label: 'Paiements', icon: 'card' },
        { href: '/admin/reconciliation', label: 'Réconciliation', icon: 'refresh' },
        { href: '/admin/jobs', label: 'Tâches planifiées', icon: 'clock' },
        { href: '/admin/outbox', label: 'DLQ événements', icon: 'queue' },
        { href: '/admin/audit', label: 'Journal d’audit', icon: 'log' },
      ],
    });
  }
  if (!hasMemberSpace(role)) {
    sections.push({
      title: 'Mon compte',
      items: [
        { href: '/notifications', label: 'Notifications', icon: 'bell' },
        { href: '/security', label: 'Sécurité', icon: 'shield' },
      ],
    });
  }
  if (isDev) {
    sections.push({
      title: 'Développement',
      items: [{ href: '/dev/messages', label: 'Messages simulés', icon: 'mail' }],
    });
  }
  return sections;
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
