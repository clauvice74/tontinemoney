import type { Metadata } from 'next';
import { ActivationForm } from '@/components/auth/activation-form';
import { AuthCard } from '@/components/auth/auth-card';

export const metadata: Metadata = { title: 'Activer mon compte' };

export default function ActivateWithCodePage() {
  return (
    <AuthCard
      title="Activer mon compte"
      description="Saisissez l’identifiant et le code reçus, puis choisissez votre mot de passe."
    >
      <ActivationForm />
    </AuthCard>
  );
}
