import type { PlatformRole } from '@tontine/contracts';
import type { MessageKey } from './i18n';

export interface NavItem {
  href: string;
  /** Clé de traduction du libellé. */
  label: MessageKey;
  /** Libellé non traduit (nom de tontine) : remplace `label` à l'affichage. */
  text?: string;
  icon: NavIcon;
  /** Correspondance exacte du chemin pour l'état actif. */
  exact?: boolean;
  /** Sous-navigation (sidebar desktop, tiroir mobile). */
  children?: NavItem[];
  /** Pastille de notifications non lues. */
  badge?: 'unread';
}

/** Navigation selon le rôle (charte : sidebar desktop, barre basse mobile, menu du compte). */
export interface Navigation {
  /** Sidebar desktop : Accueil, Tontines, Wallet, Reporting, Administration (selon le rôle). */
  primary: NavItem[];
  /** Barre basse mobile (espace membre) : Accueil, Tontines, Wallet, Notifications, Profil. */
  bottom: NavItem[];
  /** Menu du compte (en-tête). */
  account: NavItem[];
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
  | 'mail'
  | 'chart'
  | 'palette';

export const isDev = process.env.NODE_ENV !== 'production';

/**
 * Outils de simulation (confirmation USSD, messages simulés) : actifs en développement, ou dans un
 * build de démonstration avec NEXT_PUBLIC_ENABLE_SIMULATORS=true. L'API refuse de toute façon les
 * routes /psp-sim et /dev en production.
 */
export const simulatorsEnabled = isDev || process.env.NEXT_PUBLIC_ENABLE_SIMULATORS === 'true';

/** Rôles disposant d'un espace membre (profil, portefeuille, tontines). */
export function hasMemberSpace(role: PlatformRole): boolean {
  return role === 'MEMBER' || role === 'TONTINE_ADMIN';
}

/** Page d'accueil après connexion selon le rôle. */
export function homeFor(role: PlatformRole): string {
  if (role === 'SUPER_ADMIN') return '/admin';
  if (role === 'KYC_AGENT') return '/kyc-review';
  if (role === 'COMPLIANCE_AGENT') return '/kyc-review/aml';
  return '/dashboard';
}

/** Outils de la plateforme (super-administrateur) : sidebar et page d'accueil /admin. */
export const PLATFORM_TOOLS: NavItem[] = [
  { href: '/admin/tontine-admins/new', label: 'nav.createAdmin', icon: 'plus' },
  { href: '/admin/access-requests', label: 'nav.accessRequests', icon: 'inbox' },
  { href: '/admin/users', label: 'nav.users', icon: 'users' },
  { href: '/admin/members', label: 'nav.members', icon: 'user' },
  { href: '/admin/compliance', label: 'nav.complianceRules', icon: 'scale', exact: true },
  { href: '/admin/compliance/violations', label: 'nav.violations', icon: 'alert' },
  { href: '/admin/fraud', label: 'nav.fraud', icon: 'alert' },
  { href: '/admin/jobs', label: 'nav.jobs', icon: 'clock' },
  { href: '/admin/outbox', label: 'nav.outbox', icon: 'queue' },
  { href: '/admin/audit', label: 'nav.audit', icon: 'log' },
];

/** Flux financiers de la plateforme (rubrique « Wallet » du super-administrateur). */
export const PLATFORM_MONEY: NavItem[] = [
  { href: '/admin/transactions', label: 'nav.transactions', icon: 'receipt' },
  { href: '/admin/payments', label: 'nav.payments', icon: 'card' },
  { href: '/admin/reconciliation', label: 'nav.reconciliation', icon: 'refresh' },
];

const KYC_REVIEW: NavItem[] = [
  { href: '/kyc-review', label: 'nav.kycQueue', icon: 'scan', exact: true },
  { href: '/kyc-review/duplicates', label: 'nav.kycDuplicates', icon: 'copy' },
  { href: '/kyc-review/aml', label: 'nav.amlMatches', icon: 'search' },
];

const DEV_TOOLS: NavItem = {
  href: '/dev/ui-kit',
  label: 'nav.development',
  icon: 'palette',
  children: [
    { href: '/dev/messages', label: 'nav.simulatedMessages', icon: 'mail' },
    { href: '/dev/ui-kit', label: 'nav.uiKit', icon: 'palette' },
  ],
};

export function buildNavigation(
  role: PlatformRole,
  adminTontines: Array<{ id: string; name: string }>,
): Navigation {
  const primary: NavItem[] = [];
  let bottom: NavItem[] = [];
  let account: NavItem[];
  if (hasMemberSpace(role)) {
    primary.push(
      { href: '/dashboard', label: 'nav.home', icon: 'dashboard' },
      { href: '/tontines', label: 'nav.tontines', icon: 'tontines' },
      { href: '/wallet', label: 'nav.wallet', icon: 'wallet' },
    );
    if (adminTontines.length > 0) {
      primary.push(
        { href: '/reporting', label: 'nav.reporting', icon: 'chart' },
        {
          href: `/tontines/${adminTontines[0]!.id}/admin`,
          label: 'nav.administration',
          icon: 'settings',
          children: [
            ...adminTontines.map((t) => ({
              href: `/tontines/${t.id}/admin`,
              label: 'nav.administration' as const,
              text: t.name,
              icon: 'settings' as const,
            })),
            { href: '/tontines/new', label: 'nav.createTontine', icon: 'plus' },
          ],
        },
      );
    }
    bottom = [
      { href: '/dashboard', label: 'nav.home', icon: 'dashboard' },
      { href: '/tontines', label: 'nav.tontines', icon: 'tontines' },
      { href: '/wallet', label: 'nav.wallet', icon: 'wallet' },
      { href: '/notifications', label: 'nav.notifications', icon: 'bell', badge: 'unread' },
      { href: '/profile', label: 'nav.profile', icon: 'user' },
    ];
    account = [
      { href: '/profile', label: 'nav.profile', icon: 'user' },
      { href: '/kyc', label: 'nav.kyc', icon: 'id' },
      { href: '/security', label: 'nav.security', icon: 'shield' },
    ];
  } else {
    account = [
      { href: '/notifications', label: 'nav.notifications', icon: 'bell', badge: 'unread' },
      { href: '/security', label: 'nav.security', icon: 'shield' },
    ];
  }
  if (role === 'SUPER_ADMIN') {
    primary.push(
      { href: '/admin', label: 'nav.home', icon: 'dashboard', exact: true },
      { href: '/admin/tontines', label: 'nav.tontines', icon: 'tontines' },
      {
        href: '/admin/transactions',
        label: 'nav.wallet',
        icon: 'wallet',
        children: PLATFORM_MONEY,
      },
      { href: '/reporting', label: 'nav.reporting', icon: 'chart' },
      {
        href: '/admin/users',
        label: 'nav.administration',
        icon: 'settings',
        children: PLATFORM_TOOLS,
      },
      { href: '/kyc-review', label: 'nav.kycReview', icon: 'scan', children: KYC_REVIEW },
    );
  }
  if (role === 'KYC_AGENT') {
    primary.push(...KYC_REVIEW);
  }
  if (role === 'COMPLIANCE_AGENT') {
    primary.push({ href: '/kyc-review/aml', label: 'nav.amlMatches', icon: 'search' });
  }
  if (simulatorsEnabled) primary.push(DEV_TOOLS);
  return { primary, bottom, account };
}

/** Élément actif, ou l'un de ses enfants. */
export function isActiveTree(pathname: string, item: NavItem): boolean {
  return isActive(pathname, item) || (item.children ?? []).some((c) => isActiveTree(pathname, c));
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
