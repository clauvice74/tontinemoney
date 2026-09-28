'use client';

import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  cn,
} from '@tontine/ui';
import {
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  Clock,
  Copy,
  CreditCard,
  House,
  IdCard,
  Inbox,
  ListOrdered,
  LogOut,
  Mail,
  Menu,
  Palette,
  Plus,
  Receipt,
  RefreshCw,
  Scale,
  ScanFace,
  ScrollText,
  Search,
  Settings,
  Shield,
  TriangleAlert,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { logout } from '@/lib/auth/session';
import { type Locale, type ThemePreference, useI18n } from '@/lib/i18n';
import {
  type NavIcon,
  type NavItem,
  buildNavigation,
  isActive,
  isActiveTree,
} from '@/lib/navigation';
import { useAdminTontines, useCurrentUser, useUnreadCount } from '@/lib/queries';
import { Logo } from './logo';

const ICONS: Record<NavIcon, typeof House> = {
  dashboard: House,
  wallet: Wallet,
  tontines: Users,
  bell: Bell,
  id: IdCard,
  user: User,
  shield: Shield,
  plus: Plus,
  settings: Settings,
  users: Users,
  inbox: Inbox,
  scale: Scale,
  alert: TriangleAlert,
  receipt: Receipt,
  card: CreditCard,
  refresh: RefreshCw,
  clock: Clock,
  queue: ListOrdered,
  log: ScrollText,
  scan: ScanFace,
  copy: Copy,
  search: Search,
  mail: Mail,
  chart: BarChart3,
  palette: Palette,
};

function useLabel() {
  const { t } = useI18n();
  return (item: NavItem) => item.text ?? t(item.label);
}

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * Navigation latérale (charte §09) : fond navy, indicateur actif or, texte actif or pâle.
 * Un groupe s'ouvre sur sa rubrique active ; les autres se déplient au clavier ou à la souris.
 */
function SideNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const labelOf = useLabel();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const linkClass = (active: boolean, nested = false) =>
    cn(
      'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-ring',
      nested && 'py-1.5 pl-10 text-[13px]',
      active
        ? 'bg-nav-hover font-medium text-nav-active before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-r-sm before:bg-nav-indicator'
        : 'text-nav-foreground hover:bg-nav-hover hover:text-nav-active',
    );
  return (
    <nav aria-label={t('nav.main')}>
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const id = `${item.label}-${item.href}`;
          if (!item.children?.length) {
            const active = isActive(pathname, item);
            return (
              <li key={id}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={linkClass(active)}
                >
                  <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                  <span className="truncate">{labelOf(item)}</span>
                </Link>
              </li>
            );
          }
          const inTree = isActiveTree(pathname, item);
          const expanded = open[id] ?? inTree;
          const panelId = `nav-${id.replace(/[^a-z0-9]/gi, '-')}`;
          return (
            <li key={id}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpen((o) => ({ ...o, [id]: !expanded }))}
                className={cn(linkClass(false), 'w-full', inTree && 'text-nav-active')}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate text-left">{labelOf(item)}</span>
                <ChevronDown
                  className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>
              {expanded ? (
                <ul id={panelId} className="mt-1 space-y-0.5">
                  {item.children.map((c) => {
                    const active = isActive(pathname, c);
                    return (
                      <li key={`${c.href}-${c.text ?? c.label}`}>
                        <Link
                          href={c.href}
                          onClick={onNavigate}
                          aria-current={active ? 'page' : undefined}
                          className={linkClass(active, true)}
                        >
                          <span className="truncate">{labelOf(c)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Barre basse mobile (espace membre) : 5 destinations, pastille des notifications non lues. */
function BottomNav({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const labelOf = useLabel();
  return (
    <nav
      aria-label={t('nav.mobile')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-nav bg-nav pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActiveTree(pathname, item);
          const count = item.badge === 'unread' ? unread : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={count > 0 ? t('nav.notificationsUnread', { count }) : undefined}
                className={cn(
                  'relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-ring',
                  active
                    ? 'font-medium text-nav-active before:absolute before:inset-x-4 before:top-0 before:h-1 before:rounded-b-sm before:bg-nav-indicator'
                    : 'text-nav-foreground hover:text-nav-active',
                )}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  <UnreadDot count={count} />
                </span>
                <span className="truncate">{labelOf(item)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Menu du compte : liens personnels, langue, apparence, déconnexion. */
function AccountMenu({ items, onLogout }: { items: NavItem[]; onLogout: () => void }) {
  const user = useCurrentUser();
  const { t, locale, setLocale, theme, setTheme } = useI18n();
  const labelOf = useLabel();
  const router = useRouter();
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`;
  const locales: Array<[Locale, string]> = [
    ['fr', t('prefs.french')],
    ['en', t('prefs.english')],
  ];
  const themes: Array<[ThemePreference, string]> = [
    ['system', t('prefs.themeSystem')],
    ['light', t('prefs.themeLight')],
    ['dark', t('prefs.themeDark')],
  ];
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={t('nav.accountMenu', { name })}
          className="flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-md sm:pr-2"
        >
          <Avatar name={name} seed={user.id} size="md" />
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight">{name}</span>
            <span className="block text-xs text-muted-foreground">
              {t(`roles.${user.role}` as 'roles.MEMBER')}
            </span>
          </span>
          <ChevronDown
            className="hidden size-4 text-muted-foreground sm:block"
            aria-hidden="true"
          />
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-60">
        <DropdownLabel>{t('nav.account')}</DropdownLabel>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <DropdownItem key={item.href} onSelect={() => router.push(item.href)}>
              <Icon aria-hidden="true" />
              {labelOf(item)}
            </DropdownItem>
          );
        })}
        <DropdownSeparator />
        <DropdownLabel>{t('prefs.language')}</DropdownLabel>
        {locales.map(([l, text]) => (
          <DropdownItem key={l} onSelect={() => setLocale(l)} aria-current={locale === l}>
            <Check className={cn(locale === l ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
            <span lang={l}>{text}</span>
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownLabel>{t('prefs.theme')}</DropdownLabel>
        {themes.map(([v, text]) => (
          <DropdownItem key={v} onSelect={() => setTheme(v)} aria-current={theme === v}>
            <Check className={cn(theme === v ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
            {text}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem destructive onSelect={onLogout}>
          <LogOut aria-hidden="true" />
          {t('nav.logout')}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

/**
 * Coquille de l'application (mobile first) : barre du haut, sidebar navy (≥ 1024 px),
 * barre basse de l'espace membre (< 1024 px), tiroir de navigation sur mobile.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const router = useRouter();
  const { t } = useI18n();
  const [drawer, setDrawer] = useState(false);
  const adminTontines = useAdminTontines();
  const unread = useUnreadCount().data ?? 0;

  const nav = useMemo(
    () =>
      user
        ? buildNavigation(
            user.role,
            adminTontines.data.map((x) => ({ id: x.id, name: x.name })),
          )
        : { primary: [], bottom: [], account: [] },
    [user, adminTontines.data],
  );
  const hasBottom = nav.bottom.length > 0;
  const home = nav.primary[0]?.href ?? '/dashboard';

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        {t('common.skipToContent')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-nav lg:flex">
        <div className="px-5 py-5">
          <Logo href={home} onNavy tagline />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <SideNav items={nav.primary} />
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('nav.openMenu')}
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <Logo href={home} className="lg:hidden" />
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className={cn(hasBottom && 'hidden lg:inline-flex')}
            >
              <Link
                href="/notifications"
                aria-label={
                  unread > 0
                    ? t('nav.notificationsUnread', { count: unread })
                    : t('nav.notifications')
                }
                className="relative"
              >
                <Bell aria-hidden="true" />
                <UnreadDot count={unread} />
              </Link>
            </Button>
            <AccountMenu items={nav.account} onLogout={() => void onLogout()} />
          </div>
        </div>
      </header>

      <Dialog open={drawer} onOpenChange={setDrawer}>
        <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none rounded-r-xl border-0 bg-nav p-4 text-nav-foreground [&>button]:text-nav-foreground">
          <DialogTitle className="sr-only">{t('nav.menu')}</DialogTitle>
          <div className="mb-4 pr-8">
            <Logo href={home} onNavy tagline />
          </div>
          <SideNav items={nav.primary} onNavigate={() => setDrawer(false)} />
        </DialogContent>
      </Dialog>

      <main
        id="contenu"
        tabIndex={-1}
        className={cn(
          'mx-auto max-w-6xl px-4 py-6 focus:outline-none lg:px-8 lg:py-8',
          hasBottom && 'pb-24 lg:pb-8',
        )}
      >
        {children}
      </main>

      {hasBottom ? <BottomNav items={nav.bottom} unread={unread} /> : null}
    </div>
  );
}
