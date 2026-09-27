'use client';

import { REPORT_KINDS } from '@tontine/contracts';
import { Alert, Button, Card, CardContent, FormField, Input, Select } from '@tontine/ui';
import { Download, FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ComingSoon } from '@/components/feedback';
import { Section } from '@/components/page-header';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import { saveBlob } from '@/lib/download';
import { formatError } from '@/lib/forms';
import { REPORT_KIND_LABELS } from '@/lib/labels';

type Kind = (typeof REPORT_KINDS)[number];

/** Rapports financiers (US-10.4) : téléchargement PDF / CSV. */
export default function TontineReportsPage() {
  const { id } = useParams<{ id: string }>();
  const now = new Date();
  const [kind, setKind] = useState<Kind>('CONTRIBUTIONS');
  const [cycleNumber, setCycleNumber] = useState('1');
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pending, setPending] = useState<'pdf' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function download(format: 'pdf' | 'csv') {
    setPending(format);
    setError(null);
    try {
      const blob = await api.get<Blob>(`/tontines/${id}/reports`, {
        responseType: 'blob',
        query: {
          kind,
          format,
          cycleNumber: kind === 'CYCLE' ? cycleNumber : undefined,
          year: kind === 'MONTHLY' || kind === 'ANNUAL' ? year : undefined,
          month: kind === 'MONTHLY' ? month : undefined,
          from: kind === 'CONTRIBUTIONS' || kind === 'PENALTIES' ? from : undefined,
          to: kind === 'CONTRIBUTIONS' || kind === 'PENALTIES' ? to : undefined,
        },
      });
      saveBlob(
        blob,
        `rapport-${kind.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
      else setError(formatError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <Section title="Rapports financiers" description="Exports PDF (lecture) ou CSV (tableur).">
      {unavailable ? <ComingSoon title="Rapports bientôt disponibles" /> : null}
      <Card>
        <CardContent className="space-y-4 pt-5">
          {error ? <Alert variant="destructive" title={error} /> : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id="report-kind" label="Type de rapport">
              <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {REPORT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {REPORT_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </FormField>
            {kind === 'CYCLE' ? (
              <FormField id="report-cycle" label="Numéro de cycle">
                <Input
                  type="number"
                  min={1}
                  value={cycleNumber}
                  onChange={(e) => setCycleNumber(e.target.value)}
                />
              </FormField>
            ) : null}
            {kind === 'MONTHLY' || kind === 'ANNUAL' ? (
              <FormField id="report-year" label="Année">
                <Input
                  type="number"
                  min={2000}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </FormField>
            ) : null}
            {kind === 'MONTHLY' ? (
              <FormField id="report-month" label="Mois">
                <Select value={month} onChange={(e) => setMonth(e.target.value)}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(
                        new Date(2026, i, 1),
                      )}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            {kind === 'CONTRIBUTIONS' || kind === 'PENALTIES' ? (
              <>
                <FormField id="report-from" label="Du">
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </FormField>
                <FormField id="report-to" label="Au">
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </FormField>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void download('pdf')}
              loading={pending === 'pdf'}
              disabled={pending !== null}
            >
              <FileText aria-hidden="true" /> Télécharger en PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => void download('csv')}
              loading={pending === 'csv'}
              disabled={pending !== null}
            >
              <Download aria-hidden="true" /> Télécharger en CSV
            </Button>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}
