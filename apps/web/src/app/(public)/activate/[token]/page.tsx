import type { Metadata } from 'next';
import { ActivationFlow } from '@/components/auth/activation-form';

export const metadata: Metadata = { title: 'Activer mon compte' };

/** Activation par lien (48 h) : création du mot de passe. */
export default async function ActivateWithTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ActivationFlow token={decodeURIComponent(token)} />;
}
