import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { simulatorsEnabled } from '@/lib/navigation';
import { DevMessages } from './dev-messages';

export const metadata: Metadata = { title: 'Messages simulés (dev)' };

/**
 * Console des SMS / e-mails simulés : développement et builds de démonstration
 * (`pnpm build:demo`), comme le lien « Messages simulés » de l'en-tête. En production,
 * la page est absente et l'API renvoie de toute façon 404 (A-25).
 */
export default function DevMessagesPage() {
  if (!simulatorsEnabled) notFound();
  return <DevMessages />;
}
