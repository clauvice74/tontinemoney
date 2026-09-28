import type { Metadata } from 'next';
import { ActivationFlow } from '@/components/auth/activation-form';

export const metadata: Metadata = { title: 'Activer mon compte' };

/** Activation par code (OTP à 6 chiffres) puis création du mot de passe. */
export default function ActivateWithCodePage() {
  return <ActivationFlow />;
}
