'use client';

import { Card, CardContent, Stepper } from '@tontine/ui';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { Logo } from '../logo';

export type SignupStep = 'signup' | 'validation' | 'code' | 'password';
const STEPS: SignupStep[] = ['signup', 'validation', 'code', 'password'];

/**
 * Mise en page des écrans d'authentification (mobile d'abord) : sur ordinateur, panneau de
 * marque navy (promesse, points de confiance) à gauche du formulaire ; sur mobile, le
 * formulaire seul. `step` affiche l'étape du parcours d'inscription.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
  step,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  step?: SignupStep;
}) {
  const { t } = useI18n();
  const points = [
    t('auth.brandPoints.one'),
    t('auth.brandPoints.two'),
    t('auth.brandPoints.three'),
  ];
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-10 px-4 py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:py-16">
      <aside className="sticky top-8 hidden min-h-[520px] flex-col justify-between rounded-xl bg-nav p-10 lg:flex">
        <Logo onNavy tagline href="/" />
        <div className="space-y-6">
          <h2 className="max-w-md text-h1 text-gold-pale">{t('auth.brandTitle')}</h2>
          <ul className="space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-nav-foreground">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-gold-vivid text-navy"
                >
                  <Check className="size-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-nav-foreground">CIGALE · {t('common.tagline')}</p>
      </aside>

      <div className="mx-auto w-full max-w-md space-y-6 lg:max-w-none">
        {step ? (
          <Stepper
            label={t('auth.stepsLabel')}
            steps={STEPS.map((s) => t(`auth.steps.${s}`))}
            current={STEPS.indexOf(step)}
          />
        ) : null}
        <div className="space-y-2">
          <h1 className="text-h1">{title}</h1>
          {description ? <p className="text-muted-foreground">{description}</p> : null}
        </div>
        <Card>
          <CardContent className="pt-5">{children}</CardContent>
        </Card>
        {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}
