'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tontine/ui';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/lib/i18n';
import { type NavItem, PLATFORM_MONEY, PLATFORM_TOOLS } from '@/lib/navigation';

const DESCRIPTIONS: Record<string, string> = {
  '/admin/tontine-admins/new': 'Créer le compte d’un administrateur de tontine (US-1.1).',
  '/admin/access-requests': 'Valider ou refuser les demandes de compte (US-10.1).',
  '/admin/users': 'Rechercher un compte, déverrouiller.',
  '/admin/members': 'Suspendre ou réactiver un membre.',
  '/admin/tontines': 'Mettre en pause ou reprendre une tontine.',
  '/admin/compliance': 'Règles de conformité par pays et historique.',
  '/admin/compliance/violations': 'Opérations bloquées ou signalées.',
  '/admin/fraud': 'Signaler un membre pour fraude.',
  '/admin/transactions': 'Consulter et contre-passer des transactions.',
  '/admin/payments': 'Rembourser un paiement.',
  '/admin/reconciliation': 'Rapprochements interne et PSP, écarts, export CSV.',
  '/admin/jobs': 'Tâches planifiées : liste et exécution manuelle.',
  '/admin/outbox': 'Événements en échec définitif (DLQ).',
  '/admin/audit': 'Journal d’audit en lecture seule.',
};

export default function AdminHomePage() {
  const { t } = useI18n();
  const items: NavItem[] = [
    { href: '/admin/tontines', label: 'nav.tontines', icon: 'tontines' },
    ...PLATFORM_TOOLS,
    ...PLATFORM_MONEY,
  ];
  return (
    <div>
      <PageHeader
        title="Administration de la plateforme"
        description="Outils réservés au super-administrateur."
      />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle>{t(i.label)}</CardTitle>
                  <CardDescription>{DESCRIPTIONS[i.href]}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
