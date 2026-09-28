'use client';

import { toast } from '@tontine/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { type LoginOutcome, LoginForm } from '@/components/auth/login-form';
import { useAuthStore } from '@/lib/auth/store';
import { useI18n } from '@/lib/i18n';
import { homeFor } from '@/lib/navigation';

/** N'accepte que des chemins internes pour la redirection post-connexion. */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

function LoginContent() {
  const { t } = useI18n();
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
        title: t('auth.login.recoveryExhaustedTitle'),
        description: t('auth.login.recoveryExhaustedBody'),
        variant: 'destructive',
      });
    }
    if (mfaSetupRequired) {
      toast({ title: t('auth.login.mfaSetupTitle'), description: t('auth.login.mfaSetupBody') });
      router.replace('/security');
      return;
    }
    toast.success(t('auth.login.welcome', { name: me.firstName }));
    router.replace(next ?? homeFor(me.role));
  }

  return (
    <AuthCard
      title={t('auth.login.title')}
      description={t('auth.login.description')}
      footer={
        <>
          {t('auth.login.noAccount')}{' '}
          <Link
            href="/request-account"
            className="font-medium text-info underline underline-offset-4"
          >
            {t('auth.login.signup')}
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
