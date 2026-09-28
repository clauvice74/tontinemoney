'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  toast,
} from '@tontine/ui';
import { BarChart3, Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { formatError } from '@/lib/forms';
import { useI18n } from '@/lib/i18n';
import { useAdminTontines, useCurrentUser } from '@/lib/queries';

const PLATFORM_REPORTS = [
  'financial',
  'contributions',
  'wallets',
  'compliance',
  'tontines',
] as const;
type PlatformReport = (typeof PLATFORM_REPORTS)[number];

/**
 * Reporting : rapports des tontines administrées (US-10.4) et, pour le super-administrateur,
 * rapports de la plateforme (servis par le reporting-service via le gateway).
 */
export default function ReportingPage() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const tontines = useAdminTontines();
  const [pending, setPending] = useState<string | null>(null);

  async function download(report: PlatformReport, format: 'csv' | 'pdf') {
    setPending(`${report}-${format}`);
    try {
      const blob = await api.get<Blob>('/reports/export', {
        responseType: 'blob',
        query: { report, format },
      });
      saveBlob(blob, `rapport-${report}.${format}`);
    } catch (e) {
      toast({
        title: t('reporting.downloadFailed'),
        description: formatError(e),
        variant: 'destructive',
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t('reporting.title')} description={t('reporting.description')} />

      {user?.role !== 'SUPER_ADMIN' ? (
        <section aria-labelledby="rep-tontines" className="space-y-3">
          <h2 id="rep-tontines" className="text-h2">
            {t('reporting.tontinesTitle')}
          </h2>
          {tontines.data.length === 0 ? (
            <EmptyState
              icon={<BarChart3 aria-hidden="true" />}
              title={t('reporting.tontinesEmpty')}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {tontines.data.map((x) => (
                <li key={x.id}>
                  <Card>
                    <CardHeader>
                      <CardTitle>{x.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/tontines/${x.id}/admin/reports`}>
                          {t('reporting.openReports')}
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section aria-labelledby="rep-platform" className="space-y-3">
          <div>
            <h2 id="rep-platform" className="text-h2">
              {t('reporting.platformTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('reporting.platformDescription')}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {PLATFORM_REPORTS.map((r) => {
              const name = t(`reporting.reports.${r}`);
              return (
                <li key={r}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle>{name}</CardTitle>
                      <CardDescription>{t('reporting.platformDescription')}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-2">
                      {(['csv', 'pdf'] as const).map((f) => (
                        <Button
                          key={f}
                          variant="outline"
                          size="sm"
                          loading={pending === `${r}-${f}`}
                          disabled={pending !== null}
                          aria-label={t('reporting.downloadLabel', {
                            report: name,
                            format: f.toUpperCase(),
                          })}
                          onClick={() => void download(r, f)}
                        >
                          <Download aria-hidden="true" />
                          {f === 'csv' ? t('reporting.downloadCsv') : t('reporting.downloadPdf')}
                        </Button>
                      ))}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
