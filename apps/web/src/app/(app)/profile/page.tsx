'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@tontine/ui';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { QueryState } from '@/components/feedback';
import { LanguageSwitch } from '@/components/language-switch';
import { NotificationPrefsForm } from '@/components/profile/notification-prefs-form';
import { ProfileForm } from '@/components/profile/profile-form';
import { ProfilePhoto } from '@/components/profile/profile-photo';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { ListResponse, MemberView, MfaStatus, SessionView } from '@/lib/api/types';
import { type ThemePreference, useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { useLabels } from '@/lib/i18n/labels';
import { kycAtLeast } from '@/lib/kyc';
import { qk } from '@/lib/queries';

interface HistoryRow {
  id: string;
  action: string;
  version?: number;
  changedFields?: string[];
  createdAt: string;
}

const THEMES: ThemePreference[] = ['light', 'dark', 'system'];

function ProfileHistory() {
  const { t } = useI18n();
  const f = useFormat();
  const query = useQuery({
    queryKey: ['profile', 'history'],
    queryFn: () => api.get<ListResponse<HistoryRow>>('/me/profile/history'),
  });
  return (
    <QueryState
      query={query}
      isEmpty={(d) => d.data.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t('profile.historyEmpty')}</p>}
    >
      {(d) => (
        <ol className="divide-y rounded-md border text-sm">
          {d.data.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="text-muted-foreground">{f.dateTime(h.createdAt)}</span>
              <span className="font-medium">{h.action}</span>
              {h.version ? <Badge variant="muted">v{h.version}</Badge> : null}
              {h.changedFields?.length ? (
                <span className="text-muted-foreground">({h.changedFields.join(', ')})</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </QueryState>
  );
}

/** Langue et apparence de l'interface (préférence locale, cookie). */
function AppPreferences() {
  const { t, theme, setTheme } = useI18n();
  const labels: Record<ThemePreference, string> = {
    light: t('prefs.themeLight'),
    dark: t('prefs.themeDark'),
    system: t('prefs.themeSystem'),
  };
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('prefs.language')}</p>
        <LanguageSwitch />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium" id="theme-label">
          {t('prefs.theme')}
        </p>
        <div role="group" aria-labelledby="theme-label" className="flex rounded-md border p-0.5">
          {THEMES.map((th) => (
            <button
              key={th}
              type="button"
              aria-pressed={theme === th}
              onClick={() => setTheme(th)}
              className={cn(
                'rounded-sm px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                theme === th
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {labels[th]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Résumé sécurité : MFA et sessions, lien vers l'écran dédié. */
function SecuritySummary() {
  const { t } = useI18n();
  const mfa = useQuery({ queryKey: ['mfa'], queryFn: () => api.get<MfaStatus>('/auth/mfa') });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<ListResponse<SessionView>>('/auth/sessions'),
  });
  return (
    <div className="space-y-4">
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <ShieldCheck
            className={cn('size-4', mfa.data?.enabled ? 'text-success' : 'text-muted-foreground')}
            aria-hidden="true"
          />
          {mfa.isPending ? '…' : mfa.data?.enabled ? t('profile.mfaOn') : t('profile.mfaOff')}
        </li>
        <li className="text-muted-foreground">
          {sessions.data ? t('profile.sessionsCount', { count: sessions.data.data.length }) : '…'}
        </li>
      </ul>
      <Button asChild variant="secondary">
        <Link href="/security">{t('profile.manageSecurity')}</Link>
      </Button>
    </div>
  );
}

/** Profil (US-2.2, US-8.5) : identité, adresse, préférences, sécurité, historique. */
export default function ProfilePage() {
  const { t } = useI18n();
  const labels = useLabels();
  const profile = useQuery({
    queryKey: qk.profile,
    queryFn: () => api.get<MemberView>('/me/profile'),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h1">{t('profile.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('profile.description')}</p>
      </div>
      <QueryState query={profile}>
        {(p) => (
          <>
            <Card>
              <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <ProfilePhoto hasPhoto={p.hasPhoto} />
                </div>
                <div className="space-y-2 sm:text-right">
                  <p className="text-h3 font-medium">
                    {p.firstName} {p.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[p.email, p.phone].filter(Boolean).join(' · ')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="sr-only">{t('profile.memberStatus')} :</span>
                    <StatusBadge status={p.status} labels={labels.memberStatus} />
                    <Badge variant={kycAtLeast(p.kycLevel, 'TIER_2') ? 'success' : 'warning'}>
                      {t('profile.kycLevel', { level: labels.kycLevel[p.kycLevel] ?? p.kycLevel })}
                    </Badge>
                  </div>
                  {!kycAtLeast(p.kycLevel, 'TIER_2') ? (
                    <Link
                      href="/kyc"
                      className="inline-block text-sm font-medium text-info underline underline-offset-4"
                    >
                      {t('profile.verifyIdentity')}
                    </Link>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="info">
              <TabsList className="w-full justify-start sm:w-auto">
                <TabsTrigger value="info">{t('profile.tabs.info')}</TabsTrigger>
                <TabsTrigger value="preferences">{t('profile.tabs.preferences')}</TabsTrigger>
                <TabsTrigger value="security">{t('profile.tabs.security')}</TabsTrigger>
                <TabsTrigger value="history">{t('profile.tabs.history')}</TabsTrigger>
              </TabsList>
              <TabsContent value="info">
                <Card>
                  <CardContent className="pt-5">
                    <ProfileForm profile={p} sections={['personal', 'address']} />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="preferences" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('profile.appTitle')}</CardTitle>
                    <CardDescription>{t('profile.appDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AppPreferences />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('profile.messagesTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ProfileForm profile={p} sections={['messages']} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('profile.notificationsTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <NotificationPrefsForm profile={p} />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="security">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('profile.tabs.security')}</CardTitle>
                    <CardDescription>{t('profile.securitySummary')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SecuritySummary />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="history">
                <Card>
                  <CardContent className="pt-5">
                    <ProfileHistory />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </QueryState>
    </div>
  );
}
