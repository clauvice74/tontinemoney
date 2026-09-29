'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, KpiCard } from '@tontine/ui';
import {
  AlertTriangle,
  ArrowLeftRight,
  CreditCard,
  FileSearch,
  Inbox,
  Scale,
  ServerCrash,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { Amount } from '@/components/amount';
import { QueryState } from '@/components/feedback';
import { api } from '@/lib/api';
import { type MessageKey, useI18n } from '@/lib/i18n';
import { useFormat } from '@/lib/i18n/format';
import { moneyOf } from '@/lib/money';

interface PlatformOverview {
  generatedAt: string;
  accounts: { byStatus: Record<string, number>; pendingAccessRequests: number };
  kyc: { byStatus: Record<string, number> };
  compliance: { openCasesBySeverity: Record<string, number>; unassignedOpenCases: number };
  payments: { inFlight: Record<string, number> };
  transactionsToday: Array<{ currency: string; count: number; amountMinor: string }>;
  operations: {
    deadEvents: number;
    failedJobs24h: number;
    lastReconciliation: {
      kind: string;
      businessDate: string;
      status: string;
      discrepancyCount: number;
      alert: boolean;
    } | null;
  };
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/** Outils regroupés par domaine (prompt : administrateurs, conformité, incidents, audit). */
const GROUPS: Array<{ key: string; tools: Array<{ href: string; key: string }> }> = [
  {
    key: 'accounts',
    tools: [
      { href: '/admin/users', key: 'users' },
      { href: '/admin/tontine-admins/new', key: 'createAdmin' },
      { href: '/admin/access-requests', key: 'accessRequests' },
      { href: '/admin/members', key: 'members' },
    ],
  },
  { key: 'tontines', tools: [{ href: '/admin/tontines', key: 'tontines' }] },
  {
    key: 'compliance',
    tools: [
      { href: '/admin/compliance', key: 'complianceRules' },
      { href: '/admin/compliance/violations', key: 'violations' },
      { href: '/admin/fraud', key: 'fraud' },
    ],
  },
  {
    key: 'money',
    tools: [
      { href: '/admin/transactions', key: 'transactions' },
      { href: '/admin/payments', key: 'payments' },
      { href: '/admin/reconciliation', key: 'reconciliation' },
    ],
  },
  {
    key: 'incidents',
    tools: [
      { href: '/admin/outbox', key: 'outbox' },
      { href: '/admin/jobs', key: 'jobs' },
    ],
  },
  { key: 'audit', tools: [{ href: '/admin/audit', key: 'audit' }] },
];

const TOOL_LABEL: Record<string, MessageKey> = {
  users: 'nav.users',
  createAdmin: 'nav.createAdmin',
  accessRequests: 'nav.accessRequests',
  members: 'nav.members',
  tontines: 'nav.tontines',
  complianceRules: 'nav.complianceRules',
  violations: 'nav.violations',
  fraud: 'nav.fraud',
  transactions: 'nav.transactions',
  payments: 'nav.payments',
  reconciliation: 'nav.reconciliation',
  outbox: 'nav.outbox',
  jobs: 'nav.jobs',
  audit: 'nav.audit',
};

/** Tableau global de la plateforme (super-admin) : indicateurs puis outils par domaine. */
export default function AdminHomePage() {
  const { t } = useI18n();
  const f = useFormat();
  const overview = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get<PlatformOverview>('/admin/dashboard'),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-h1">{t('platform.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('platform.description')}</p>
      </div>

      <QueryState query={overview}>
        {(o) => {
          const recon = o.operations.lastReconciliation;
          return (
            <section aria-labelledby="platform-kpis" className="space-y-3">
              <h2 id="platform-kpis" className="sr-only">
                {t('platform.title')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t('platform.generatedAt', { date: f.dateTime(o.generatedAt) })}
              </p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label={t('platform.kpi.users')}
                  icon={<Users />}
                  value={o.accounts.byStatus.ACTIVE ?? 0}
                  hint={t('platform.kpi.usersHint', { count: sum(o.accounts.byStatus) })}
                />
                <KpiCard
                  label={t('platform.kpi.accessRequests')}
                  icon={<Inbox />}
                  value={o.accounts.pendingAccessRequests}
                  tone={o.accounts.pendingAccessRequests > 0 ? 'warning' : 'default'}
                />
                <KpiCard
                  label={t('platform.kpi.kycQueue')}
                  icon={<FileSearch />}
                  value={sum(o.kyc.byStatus)}
                  tone={sum(o.kyc.byStatus) > 0 ? 'warning' : 'default'}
                />
                <KpiCard
                  label={t('platform.kpi.openCases')}
                  icon={<Scale />}
                  value={sum(o.compliance.openCasesBySeverity)}
                  tone={o.compliance.unassignedOpenCases > 0 ? 'destructive' : 'default'}
                  hint={t('platform.kpi.unassigned', {
                    count: o.compliance.unassignedOpenCases,
                  })}
                />
                <KpiCard
                  label={t('platform.kpi.inFlight')}
                  icon={<CreditCard />}
                  value={sum(o.payments.inFlight)}
                />
                <KpiCard
                  label={t('platform.kpi.txToday')}
                  icon={<ArrowLeftRight />}
                  value={o.transactionsToday.reduce((a, r) => a + r.count, 0)}
                  hint={
                    o.transactionsToday.length ? (
                      <span className="flex flex-col">
                        {o.transactionsToday.map((r) => (
                          <Amount
                            key={r.currency}
                            value={moneyOf(BigInt(r.amountMinor), r.currency)}
                            className="text-xs"
                          />
                        ))}
                      </span>
                    ) : undefined
                  }
                />
                <KpiCard
                  label={t('platform.kpi.deadEvents')}
                  icon={<ServerCrash />}
                  value={o.operations.deadEvents}
                  tone={o.operations.deadEvents > 0 ? 'destructive' : 'success'}
                  hint={`${t('platform.kpi.failedJobs')} : ${o.operations.failedJobs24h}`}
                />
                <KpiCard
                  label={t('platform.kpi.lastRecon')}
                  icon={<AlertTriangle />}
                  value={recon ? f.date(recon.businessDate) : t('platform.kpi.reconNone')}
                  tone={recon?.alert ? 'destructive' : recon ? 'success' : 'default'}
                  hint={
                    recon
                      ? recon.discrepancyCount > 0
                        ? t('platform.kpi.reconAlert', { count: recon.discrepancyCount })
                        : t('platform.kpi.reconOk')
                      : undefined
                  }
                />
              </div>
            </section>
          );
        }}
      </QueryState>

      <div className="grid gap-6 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <Card key={g.key}>
            <CardHeader>
              <CardTitle>{t(`platform.groups.${g.key}` as MessageKey)}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-md border">
                {g.tools.map((tool) => (
                  <li key={tool.href}>
                    <Link
                      href={tool.href}
                      className="block p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-sm font-medium text-info">
                        {t(TOOL_LABEL[tool.key] ?? 'nav.administration')}
                      </span>
                      <CardDescription>
                        {t(`platform.tools.${tool.key}` as MessageKey)}
                      </CardDescription>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
