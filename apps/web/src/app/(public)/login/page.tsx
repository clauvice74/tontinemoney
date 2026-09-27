'use client';

import { toast } from '@tontine/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { type LoginOutcome, LoginForm } from '@/components/auth/login-form';
import { useAuthStore } from '@/lib/auth/store';
import { homeFor } from '@/lib/navigation';

/** N'accepte que des chemins internes pour la redirection post-connexion. */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const user = useAuthStore((s) => s.user);
  // La redirection post-connexion est gérée par onAuthenticated ; l'effet ne couvre que
  // l'arrivée sur la page avec une session déjà restaurée.
  const handledByForm = useRef(false);

  useEffect(() => {
    if (user && !handledByForm.current) router.replace(next ?? homeFor(user.role));
  }, [user, next, router]);

  function onAuthenticated({ user: me, mfaSetupRequired, recoveryCodesExhausted }: LoginOutcome) {
    handledByForm.current = true;
    if (recoveryCodesExhausted) {
      toast({
        title: 'Codes de récupération épuisés',
        description: 'Générez de nouveaux codes dans « Sécurité ».',
        variant: 'destructive',
      });
    }
    if (mfaSetupRequired) {
      toast({
        title: 'Double authentification obligatoire',
        description: 'Activez-la pour accéder aux fonctions d’administration.',
      });
      router.replace('/security');
      return;
    }
    toast.success(`Bienvenue ${me.firstName} !`);
    router.replace(next ?? homeFor(me.role));
  }

  return (
    <AuthCard
      title="Connexion"
      description="Accédez à votre espace TontineMoney."
      footer={
        <>
          Pas encore de compte ?{' '}
          <Link href="/request-account" className="font-medium text-primary underline">
            Demander un compte
          </Link>
        </>
      }
    >
      <LoginForm
        onAuthenticated={onAuthenticated}
        onStart={() => {
          handledByForm.current = true;
        }}
      />
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
