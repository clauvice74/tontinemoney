'use client';

import { Button } from '@tontine/ui';
import Link from 'next/link';
import { useAuthStore } from '@/lib/auth/store';
import { homeFor, simulatorsEnabled } from '@/lib/navigation';
import { Logo } from './logo';

export function PublicHeader() {
  const user = useAuthStore((s) => s.user);
  return (
    <header className="border-b bg-card/95">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Logo />
        <nav aria-label="Navigation publique" className="ml-auto flex items-center gap-1">
          {simulatorsEnabled ? (
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/dev/messages">Messages simulés</Link>
            </Button>
          ) : null}
          {user ? (
            <Button size="sm" asChild>
              <Link href={homeFor(user.role)}>Mon espace</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/request-account">Demander un compte</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/login">Se connecter</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
