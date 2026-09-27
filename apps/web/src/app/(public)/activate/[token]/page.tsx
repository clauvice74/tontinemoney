import type { Metadata } from 'next';
import Link from 'next/link';
import { ActivationForm } from '@/components/auth/activation-form';
import { AuthCard } from '@/components/auth/auth-card';

export const metadata: Metadata = { title: 'Activer mon compte' };

export default async function ActivateWithTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <AuthCard
      title="Activer mon compte"
      description="Choisissez votre mot de passe pour finaliser l’activation (lien valable 48 h)."
      footer={
        <>
          Lien expiré ?{' '}
          <Link href="/activate" className="font-medium text-primary underline">
            Activer avec un code
          </Link>
        </>
      }
    >
      <ActivationForm token={decodeURIComponent(token)} />
    </AuthCard>
  );
}
