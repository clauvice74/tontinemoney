'use client';

import { Button } from '@tontine/ui';
import Link from 'next/link';
import { useAuthStore } from '@/lib/auth/store';
import { useI18n } from '@/lib/i18n';
import { homeFor, simulatorsEnabled } from '@/lib/navigation';
import { LanguageSwitch } from './language-switch';
import { Logo } from './logo';

export function PublicHeader() {
  const user = useAuthStore((s) => s.user);
  const { t } = useI18n();
  return (
    <header className="border-b bg-card/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
        <Logo />
        <nav aria-label={t('publicSite.nav')} className="ml-auto flex items-center gap-2">
          {simulatorsEnabled ? (
            <Button variant="ghost" size="sm" asChild className="hidden md:inline-flex">
              <Link href="/dev/messages">{t('nav.simulatedMessages')}</Link>
            </Button>
          ) : null}
          <LanguageSwitch />
          {user ? (
            <Button size="sm" asChild>
              <Link href={homeFor(user.role)}>{t('publicSite.mySpace')}</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link href="/login">{t('publicSite.login')}</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
