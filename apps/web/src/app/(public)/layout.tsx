import type { ReactNode } from 'react';
import { PublicFooter } from '@/components/public-footer';
import { PublicHeader } from '@/components/public-header';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="contenu" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
