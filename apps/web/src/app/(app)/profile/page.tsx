'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tontine/ui';
import { QueryState } from '@/components/feedback';
import { PageHeader } from '@/components/page-header';
import { NotificationPrefsForm } from '@/components/profile/notification-prefs-form';
import { ProfileForm } from '@/components/profile/profile-form';
import { ProfilePhoto } from '@/components/profile/profile-photo';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import type { ListResponse, MemberView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { KYC_LEVEL_LABELS, MEMBER_STATUS_LABELS, label } from '@/lib/labels';
import { qk } from '@/lib/queries';

interface HistoryRow {
  id: string;
  action: string;
  version?: number;
  changedFields?: string[];
  createdAt: string;
}

function ProfileHistory() {
  const query = useQuery({
    queryKey: ['profile', 'history'],
    queryFn: () => api.get<ListResponse<HistoryRow>>('/me/profile/history'),
  });
  return (
    <QueryState
      query={query}
      isEmpty={(d) => d.data.length === 0}
      empty={<p className="text-sm text-muted-foreground">Aucune modification enregistrée.</p>}
    >
      {(d) => (
        <ol className="space-y-2 text-sm">
          {d.data.map((h) => (
            <li
              key={h.id}
              className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-0"
            >
              <span className="text-muted-foreground">{formatDateTime(h.createdAt)}</span>
              <span className="font-medium">{h.action}</span>
              {h.version ? <Badge variant="outline">v{h.version}</Badge> : null}
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

export default function ProfilePage() {
  const profile = useQuery({
    queryKey: qk.profile,
    queryFn: () => api.get<MemberView>('/me/profile'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Mon profil" description="Vos informations personnelles et préférences." />
      <QueryState query={profile}>
        {(p) => (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Identité</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  Statut <StatusBadge status={p.status} labels={MEMBER_STATUS_LABELS} /> · KYC{' '}
                  {label(KYC_LEVEL_LABELS, p.kycLevel)} · version {p.version}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ProfilePhoto hasPhoto={p.hasPhoto} />
                <ProfileForm profile={p} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Préférences de notification</CardTitle>
              </CardHeader>
              <CardContent>
                <NotificationPrefsForm profile={p} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Historique des modifications</CardTitle>
              </CardHeader>
              <CardContent>
                <ProfileHistory />
              </CardContent>
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
