import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { simulatorsEnabled } from '@/lib/navigation';
import { UiKit } from './ui-kit';

export const metadata: Metadata = { title: 'UI kit' };

/** Design system TontineMoney en rendu réel (développement et builds de démonstration). */
export default function UiKitPage() {
  if (!simulatorsEnabled) notFound();
  return <UiKit />;
}
