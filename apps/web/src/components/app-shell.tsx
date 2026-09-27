'use client';

import { Badge, Button, Dialog, DialogContent, DialogTitle, cn } from '@tontine/ui';
import {
  Bell,
  Clock,
  Copy,
  CreditCard,
  IdCard,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Mail,
  Menu,
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
import { ROLE_LABELS, label } from '@/lib/labels';
import { type NavIcon, type NavSection, buildNavigation, isActive } from '@/lib/navigation';
import { useAdminTontines, useCurrentUser, useUnreadCount } from '@/lib/queries';
import { Logo } from './logo';

const ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
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
};

function NavLinks({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="space-y-6">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const adminTontines = useAdminTontines();
  const unread = useUnreadCount();

  const sections = useMemo(
    () =>
      user
        ? buildNavigation(
            user.role,
            adminTontines.data.map((t) => ({ id: t.id, name: t.name })),
          )
        : [],
    [user, adminTontines.data],
  );

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  const unreadCount = unread.data ?? 0;

  return (
    <div className="min-h-dvh">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        Aller au contenu
      </a>
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Ouvrir le menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <Logo href="/dashboard" />
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" asChild>
              <Link
                href="/notifications"
                aria-label={
                  unreadCount > 0
                    ? `Notifications (${unreadCount} non lue${unreadCount > 1 ? 's' : ''})`
                    : 'Notifications'
                }
                className="relative"
              >
                <Bell aria-hidden="true" />
                {unreadCount > 0 ? (
                  <Badge
                    variant="destructive"
                    className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px]"
                    aria-hidden="true"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                ) : null}
              </Link>
            </Button>
            {user ? (
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium leading-tight">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{label(ROLE_LABELS, user.role)}</p>
              </div>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void onLogout()}>
              <LogOut aria-hidden="true" />
              <span className="hidden sm:inline">Déconnexion</span>
            </Button>
          </div>
        </div>
      </header>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none rounded-r-xl">
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <div className="pt-4">
            <NavLinks sections={sections} onNavigate={() => setMobileOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <div className="mx-auto flex max-w-7xl gap-6 px-4">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto py-6 lg:block">
          <NavLinks sections={sections} />
        </aside>
        <main id="contenu" tabIndex={-1} className="min-w-0 flex-1 py-6 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
