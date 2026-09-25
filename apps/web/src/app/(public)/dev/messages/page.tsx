import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DevMessages } from './dev-messages';

export const metadata: Metadata = { title: 'Messages simulés (dev)' };

/** Console des SMS / emails simulés — indisponible en production. */
export default function DevMessagesPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevMessages />;
}
