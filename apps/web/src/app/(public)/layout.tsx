import type { ReactNode } from 'react';
import { PublicHeader } from '@/components/public-header';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="contenu" className="flex-1">
        {children}
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} TontineMoney — environnement de démonstration, aucune
        transaction réelle.
      </footer>
    </div>
  );
}
