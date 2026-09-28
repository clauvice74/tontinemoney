'use client';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ProgressBar,
} from '@tontine/ui';
import { BellRing, Check, ScanFace, ShieldCheck, Smartphone, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { type MessageKey, useI18n } from '@/lib/i18n';

const FEATURES: Array<{ key: string; icon: typeof Users }> = [
  { key: 'rotating', icon: Users },
  { key: 'wallet', icon: Wallet },
  { key: 'reminders', icon: BellRing },
  { key: 'kyc', icon: ScanFace },
  { key: 'security', icon: ShieldCheck },
  { key: 'mobile', icon: Smartphone },
];

const MEMBERS = ['Awa Diallo', 'Bella Nkoulou', 'Carl Mbida', 'Dora Fotso', 'Emma Tchoupo'];

/** Bienvenue : promesse, parcours d'entrée (créer un compte ou se connecter), confiance. */
export default function WelcomePage() {
  const { t } = useI18n();
  return (
    <div>
      <section className="border-b bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-2 md:items-center md:py-20">
          <div className="space-y-6">
            <Badge variant="info">{t('welcome.eyebrow')}</Badge>
            <h1 className="text-h1 md:text-[40px] md:leading-tight">{t('welcome.title')}</h1>
            <p className="max-w-prose text-base text-muted-foreground">{t('welcome.lead')}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="primary" size="lg" asChild>
                <Link href="/request-account">{t('welcome.ctaSignup')}</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/login">{t('welcome.ctaLogin')}</Link>
              </Button>
            </div>
            <ul className="space-y-2">
              {(['protected', 'transparent', 'mobile'] as const).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
                  {t(`welcome.trust.${k}`)}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              {t('welcome.haveCode')}{' '}
              <Link href="/activate" className="font-medium text-info underline underline-offset-4">
                {t('welcome.activate')}
              </Link>
            </p>
          </div>

          <Card className="shadow-md" aria-label={t('welcome.example.label')}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{t('welcome.example.tontine')}</CardTitle>
                  <CardDescription>{t('welcome.example.meta')}</CardDescription>
                </div>
                <Badge variant="success">{t('welcome.example.status')}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['welcome.example.contribution', '50 000'],
                    ['welcome.example.collected', '300 000'],
                  ] as Array<[MessageKey, string]>
                ).map(([k, v]) => (
                  <div key={k} className="rounded-md bg-muted p-3">
                    <p className="text-xs text-muted-foreground">{t(k)}</p>
                    <p className="text-h3 font-medium tabular-nums">
                      {v} <span className="text-xs font-normal text-muted-foreground">XAF</span>
                    </p>
                  </div>
                ))}
              </div>
              <ProgressBar
                value={4}
                max={6}
                label={t('welcome.example.progress')}
                valueText={t('welcome.example.cycle')}
                showLabel
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex -space-x-1">
                  {MEMBERS.map((n) => (
                    <Avatar key={n} name={n} size="sm" className="ring-2 ring-card" />
                  ))}
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {t('welcome.example.next')}
                  <span className="block text-sm font-medium text-foreground">Dora Fotso</span>
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{t('welcome.example.label')}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 md:py-16" aria-labelledby="fonctionnalites">
        <h2 id="fonctionnalites" className="mb-8 text-h2">
          {t('welcome.featuresTitle')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <Card className="h-full">
                <CardHeader>
                  <span
                    aria-hidden="true"
                    className="grid size-10 place-items-center rounded-md bg-secondary text-secondary-foreground"
                  >
                    <Icon className="size-5" />
                  </span>
                  <CardTitle>{t(`welcome.features.${key}.title` as MessageKey)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    {t(`welcome.features.${key}.text` as MessageKey)}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
