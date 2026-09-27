'use client';

import { COMPLIANCE_RULE_TYPES, OPERATION_TYPES } from '@tontine/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  Textarea,
  toast,
} from '@tontine/ui';
import { useState } from 'react';
import { ActionDialog } from '@/components/action-dialog';
import { ErrorAlert, QueryState } from '@/components/feedback';
import { RequireRole } from '@/components/guards';
import { PageHeader } from '@/components/page-header';
import { SimpleTable } from '@/components/simple-table';
import { api } from '@/lib/api';
import type { ComplianceRuleView } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { OPERATION_TYPE_LABELS, RULE_TYPE_LABELS, label } from '@/lib/labels';

const PARAM_HELP: Record<string, string> = {
  DAILY_LIMIT: '{"limitMinor": "1000000"}',
  MONTHLY_LIMIT: '{"limitMinor": "20000000"}',
  WALLET_LIMIT: '{"limitMinor": "5000000"}',
  KYC_MIN_LEVEL: '{"minLevel": "TIER_2"}',
  TONTINE_ALLOWED: '{"allowed": true, "requiresLevel": "TIER_3"}',
  OPERATION_FORBIDDEN: '{"onViolation": "BLOCK"}',
};

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function CreateRule({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState('');
  const [country, setCountry] = useState('CM');
  const [ruleType, setRuleType] = useState<string>('DAILY_LIMIT');
  const [ops, setOps] = useState<string[]>(['TRANSFER']);
  const [params, setParams] = useState(PARAM_HELP['DAILY_LIMIT']!);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseJson(params);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/compliance/rules', {
        code: code.trim().toUpperCase(),
        countryCode: country.toUpperCase(),
        ruleType,
        operationTypes: ops,
        params: parsed,
        ...(description ? { description } : {}),
      });
      toast.success('Règle créée — effet immédiat');
      setCode('');
      onCreated();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouvelle règle</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-code">Code (CC-NOM-REGLE)</Label>
          <Input
            id="r-code"
            value={code}
            placeholder="CM-DAILY-TRANSFER"
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-country">Pays (ISO 2)</Label>
          <Input
            id="r-country"
            maxLength={2}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-type">Type</Label>
          <Select
            id="r-type"
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value);
              setParams(PARAM_HELP[e.target.value] ?? '{}');
            }}
          >
            {COMPLIANCE_RULE_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(RULE_TYPE_LABELS, t)}
              </option>
            ))}
          </Select>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Opérations concernées</legend>
          <div className="grid grid-cols-2 gap-1">
            {OPERATION_TYPES.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={ops.includes(o)}
                  onChange={(e) =>
                    setOps((cur) => (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)))
                  }
                />
                {label(OPERATION_TYPE_LABELS, o)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="r-params">Paramètres (JSON, montants en unités mineures)</Label>
          <Textarea
            id="r-params"
            rows={2}
            className="font-mono text-xs"
            value={params}
            onChange={(e) => setParams(e.target.value)}
            aria-invalid={!parsed}
          />
          {!parsed ? <p className="text-xs text-destructive">JSON invalide</p> : null}
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="r-desc">Description</Label>
          <Input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error ? (
          <div className="md:col-span-2">
            <ErrorAlert error={error} />
          </div>
        ) : null}
        <div>
          <Button onClick={submit} disabled={busy || !parsed || !code || ops.length === 0}>
            Créer la règle
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** US-9.3 — catalogue de règles par pays : modifications sans redéploiement, historique versionné. */
export default function AdminCompliancePage() {
  const queryClient = useQueryClient();
  const [country, setCountry] = useState('');
  const [history, setHistory] = useState<{
    code: string;
    rows: Array<{
      version: number;
      change: string;
      reason: string | null;
      createdAt: string;
      snapshot: unknown;
    }>;
  } | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'compliance', country],
    queryFn: () =>
      api.get<{ data: ComplianceRuleView[] }>('/admin/compliance/rules', {
        query: { country: country || undefined },
      }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'compliance'] });

  return (
    <RequireRole roles={['SUPER_ADMIN']}>
      <div className="space-y-4">
        <PageHeader
          title="Règles de conformité"
          description="Effet immédiat : le cache des règles (5 min) est invalidé à chaque modification."
        />
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="c-filter">Filtrer par pays</Label>
          <Input
            id="c-filter"
            maxLength={2}
            placeholder="ex. CM"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.data.length === 0}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">Aucune règle.</p>}
        >
          {(d) => (
            <Card>
              <CardContent className="pt-4">
                <SimpleTable
                  rows={d.data}
                  rowKey={(r) => r.code}
                  columns={[
                    { header: 'Code', cell: (r) => <code className="text-xs">{r.code}</code> },
                    { header: 'Pays', cell: (r) => r.countryCode },
                    { header: 'Type', cell: (r) => label(RULE_TYPE_LABELS, r.ruleType) },
                    {
                      header: 'Opérations',
                      cell: (r) =>
                        r.operationTypes.map((o) => label(OPERATION_TYPE_LABELS, o)).join(', '),
                    },
                    {
                      header: 'Paramètres',
                      cell: (r) => <code className="text-xs">{JSON.stringify(r.params)}</code>,
                    },
                    {
                      header: 'État',
                      cell: (r) => (
                        <Badge variant={r.active ? 'success' : 'muted'}>
                          {r.active ? 'Active' : 'Inactive'}
                        </Badge>
                      ),
                    },
                    { header: 'Version', cell: (r) => r.version ?? 1 },
                    {
                      header: 'Actions',
                      srOnlyHeader: true,
                      className: 'text-right space-x-2',
                      cell: (r) => (
                        <>
                          <ActionDialog
                            trigger={r.active ? 'Désactiver' : 'Activer'}
                            triggerVariant="outline"
                            title={`${r.active ? 'Désactiver' : 'Activer'} ${r.code} ?`}
                            reason={{ label: 'Motif du changement', required: true, minLength: 3 }}
                            successMessage="Règle mise à jour"
                            onConfirm={async (reason) => {
                              await api.patch(
                                `/admin/compliance/rules/${encodeURIComponent(r.code)}`,
                                { active: !r.active, changeReason: reason },
                              );
                              await refresh();
                            }}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const h = await api.get<{
                                data: Array<{
                                  version: number;
                                  change: string;
                                  reason: string | null;
                                  createdAt: string;
                                  snapshot: unknown;
                                }>;
                              }>(`/admin/compliance/rules/${encodeURIComponent(r.code)}/history`);
                              setHistory({ code: r.code, rows: h.data });
                            }}
                          >
                            Historique
                          </Button>
                        </>
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </QueryState>
        {history ? (
          <Card>
            <CardHeader>
              <CardTitle>Historique de {history.code}</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleTable
                rows={history.rows}
                rowKey={(h) => String(h.version)}
                columns={[
                  { header: 'Version', cell: (h) => h.version },
                  { header: 'Date', cell: (h) => formatDateTime(h.createdAt) },
                  { header: 'Changement', cell: (h) => h.change },
                  { header: 'Motif', cell: (h) => h.reason ?? '—' },
                  {
                    header: 'Instantané',
                    cell: (h) => <code className="text-xs">{JSON.stringify(h.snapshot)}</code>,
                  },
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
        <CreateRule onCreated={refresh} />
      </div>
    </RequireRole>
  );
}
