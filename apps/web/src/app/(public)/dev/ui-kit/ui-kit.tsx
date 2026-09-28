'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
  EmptyState,
  FormField,
  Input,
  KpiCard,
  LoadingBlock,
  OtpInput,
  PasswordInput,
  Stepper,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Timeline,
  toast,
} from '@tontine/ui';
import { ChevronDown, Eye, Inbox, Pause, Users, Wallet } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { LogoMark } from '@/components/logo';
import { useI18n } from '@/lib/i18n';

const PALETTE: Array<{ group: string; colors: Array<[string, string, string]> }> = [
  {
    group: 'Palette principale',
    colors: [
      ['Navy foncé', '#042C53', 'Navigation, en-têtes, texte principal'],
      ['Navy moyen', '#185FA5', 'Liens, focus, informations'],
      ['Navy clair', '#E6F1FB', 'Fonds informatifs, badges KYC'],
      ['Or', '#BA7517', 'Barres de progression, indicateur actif'],
      ['Or vif', '#EF9F27', 'Bouton principal (texte navy)'],
      ['Or pâle', '#FAEEDA', 'Texte sur navy, badge « Prochain »'],
    ],
  },
  {
    group: 'Palette fonctionnelle',
    colors: [
      ['Succès', '#3B6D11', 'Paiement validé, membre actif'],
      ['Succès clair', '#EAF3DE', 'Fond badge « Actif »'],
      ['Avertissement', '#854F0B', 'Prochain versement, KYC en attente'],
      ['Erreur', '#A32D2D', 'Paiement échoué, rejet'],
      ['Erreur clair', '#FCEBEB', 'Fond alerte erreur'],
      ['Neutre', '#5F5E5A', 'Texte secondaire, suspendu'],
      ['Surface', '#F1EFE8', 'Fond de page, lignes paires'],
    ],
  },
];

const CONTRASTS: Array<[string, string, string]> = [
  ['Texte navy / surface', '12,25:1', 'AA'],
  ['Bouton principal : navy / or vif', '6,48:1', 'AA'],
  ['Navigation : or pâle / navy', '12,28:1', 'AA'],
  ['Lien et focus : navy moyen / blanc', '6,52:1', 'AA'],
  ['Texte secondaire : neutre / blanc', '6,49:1', 'AA'],
  ['Badge succès', '5,43:1', 'AA'],
  ['Badge avertissement', '5,87:1', 'AA'],
  ['Badge erreur', '6,13:1', 'AA'],
  ['Progression : or / surface', '3,23:1', 'AA (composant ≥ 3:1)'],
  ['Écarté : blanc / or #BA7517', '3,72:1', 'Non conforme (texte)'],
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** UI kit : jetons, typographie et composants officiels, en rendu réel (clair / sombre). */
export function UiKit() {
  const { setTheme, theme } = useI18n();
  const [otp, setOtp] = useState('4821');
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <LogoMark className="size-12" />
          <div>
            <h1 className="text-h1">Design system TontineMoney</h1>
            <p className="text-sm text-muted-foreground">
              Charte graphique v1.0 · Arial 400 / 500 · WCAG AA · mobile first
            </p>
          </div>
        </div>
        <div className="flex gap-2" role="group" aria-label="Apparence">
          {(['light', 'dark', 'system'] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={theme === v ? 'secondary' : 'outline'}
              aria-pressed={theme === v}
              onClick={() => setTheme(v)}
            >
              {v === 'light' ? 'Clair' : v === 'dark' ? 'Sombre' : 'Système'}
            </Button>
          ))}
        </div>
      </header>

      <Section id="couleurs" title="Couleurs">
        {PALETTE.map((p) => (
          <div key={p.group} className="space-y-2">
            <h3 className="text-h3">{p.group}</h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {p.colors.map(([name, hex, role]) => (
                <li key={hex} className="overflow-hidden rounded-lg border bg-card">
                  <div className="h-16" style={{ backgroundColor: hex }} />
                  <div className="space-y-0.5 p-3">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="font-mono text-mono text-muted-foreground">{hex}</p>
                    <p className="text-xs text-muted-foreground">{role}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Contrastes vérifiés</CardTitle>
            <CardDescription>
              Texte ≥ 4,5:1, composants et indicateurs ≥ 3:1. Le bouton principal utilise l’or vif
              avec un texte navy : l’or #BA7517 avec un texte blanc n’atteint que 3,72:1.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Couple</TableHead>
                  <TableHead>Rapport</TableHead>
                  <TableHead>Niveau</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CONTRASTS.map(([pair, ratio, level]) => (
                  <TableRow key={pair}>
                    <TableCell>{pair}</TableCell>
                    <TableCell className="tabular-nums">{ratio}</TableCell>
                    <TableCell>
                      <Badge variant={level.startsWith('Non') ? 'destructive' : 'success'}>
                        {level}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Section>

      <Section id="typo" title="Typographie">
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-h1">H1 · 32 px · 500 — Tableau de bord</p>
            <p className="text-h2">H2 · 24 px · 500 — Mes groupes actifs</p>
            <p className="text-h3">H3 · 18 px · 500 — Tontine Famille — Cycle 7/12</p>
            <p className="text-body">
              Corps · 14 px · 400 — Gérez vos tontines numériques de manière sécurisée.
            </p>
            <p className="text-caption text-muted-foreground">
              Secondaire · 12 px · 400 — 6 membres · 50 000 XAF/tour · Mensuelle
            </p>
            <p className="font-mono text-mono text-muted-foreground">
              Mono · 11 px · 400 — TXN-20260411-0042 · wallet.balance.updated
            </p>
            <p className="text-sm">
              Montant : <span className="text-h3 font-medium tabular-nums">250 000</span>{' '}
              <span className="text-xs text-muted-foreground">XAF</span> — toujours en 500, suivi de
              la devise en texte secondaire.
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section id="boutons" title="Boutons">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Payer ma contribution</Button>
              <Button variant="secondary">Voir les détails</Button>
              <Button variant="outline">Simuler</Button>
              <Button variant="ghost">Annuler</Button>
              <Button variant="danger">Supprimer</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm">
                Petit
              </Button>
              <Button variant="primary" size="md">
                Moyen (défaut)
              </Button>
              <Button variant="primary" size="lg">
                Grand
              </Button>
              <Button variant="secondary" loading>
                Chargement
              </Button>
              <Button variant="secondary" disabled>
                Désactivé
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Un seul bouton principal (or) par écran. Actions destructives : confirmation
              obligatoire.
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section id="statuts" title="Badges et alertes">
        <div className="flex flex-wrap gap-2">
          <Badge variant="success">Actif</Badge>
          <Badge variant="warning">Prochain</Badge>
          <Badge variant="info">KYC en cours</Badge>
          <Badge variant="destructive">Rejeté</Badge>
          <Badge variant="muted">Suspendu</Badge>
          <Badge variant="new">Nouveau</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Alert variant="success" title="Paiement effectué">
            Paiement de 50 000 XAF versé avec succès à Awa Diallo.
          </Alert>
          <Alert variant="warning" title="Rappel">
            Votre cotisation de 10 000 XAF est due le 15 octobre.
          </Alert>
          <Alert variant="destructive" title="Paiement échoué">
            Solde insuffisant. Rechargez votre wallet.
          </Alert>
          <Alert variant="info" title="Vérification en cours">
            Vous recevrez une confirmation sous 24 heures.
          </Alert>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast({ title: 'Cotisation payée', variant: 'success' })}
          >
            Toast succès
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast({ title: 'Paiement échoué', description: 'Réessayez.', variant: 'destructive' })
            }
          >
            Toast erreur
          </Button>
        </div>
      </Section>

      <Section id="donnees" title="Indicateurs, progression, avatars, chronologie">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Membres"
            value="1 248"
            hint="+32 ce mois"
            tone="success"
            icon={<Users />}
          />
          <KpiCard label="Wallet total" value="12 450 000" unit="XAF" icon={<Wallet />} />
          <KpiCard label="Contributions" value="96 %" hint="à l’heure" tone="success" />
          <KpiCard label="Retards" value="14" hint="à relancer" tone="warning" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tontine Famille</CardTitle>
              <CardDescription>6 membres · 50 000 XAF/tour · Mensuelle</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProgressBar
                value={7}
                max={12}
                label="Progression"
                valueText="Cycle 7 sur 12"
                showLabel
              />
              <div className="flex -space-x-2">
                {['Awa Diallo', 'Bella Nkoulou', 'Carl Mbida', 'Dora Fotso', 'Emma Tchoupo'].map(
                  (n) => (
                    <Avatar key={n} name={n} size="md" className="ring-2 ring-card" />
                  ),
                )}
              </div>
              <div className="flex items-center gap-3">
                <Avatar name="Awa Diallo" size="lg" />
                <Avatar name="Awa Diallo" size="md" />
                <Avatar name="Awa Diallo" size="sm" />
                <span className="text-xs text-muted-foreground">44 · 36 · 28 px</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cycles</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline
                items={[
                  {
                    id: '1',
                    title: 'Cycle 1 — Awa',
                    meta: '7 oct.',
                    status: 'done',
                    description: '50 000 XAF versés',
                  },
                  {
                    id: '2',
                    title: 'Cycle 2 — Bella',
                    meta: '4 nov.',
                    status: 'current',
                    description: '4/6 contributions reçues',
                  },
                  { id: '3', title: 'Cycle 3 — Carl', meta: '2 déc.', status: 'upcoming' },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="formulaires" title="Formulaires, tableau, menus, modale">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <FormField id="kit-amount" label="Montant" description="Minimum 500 XAF">
                <Input inputMode="numeric" placeholder="10 000" />
              </FormField>
              <FormField id="kit-phone" label="Téléphone" error="Numéro invalide">
                <Input defaultValue="+237 6" />
              </FormField>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-4 pt-5">
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button variant="outline">
                    Actions <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownTrigger>
                <DropdownContent align="start">
                  <DropdownItem>
                    <Eye aria-hidden="true" /> Voir
                  </DropdownItem>
                  <DropdownItem>
                    <Pause aria-hidden="true" /> Suspendre
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem destructive>Clôturer</DropdownItem>
                </DropdownContent>
              </Dropdown>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="danger">Clôturer la tontine</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clôturer la tontine ?</DialogTitle>
                    <DialogDescription>
                      Action irréversible : plus aucune contribution ne sera acceptée.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="ghost">Annuler</Button>
                    <Button variant="danger">Clôturer</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ['Awa Diallo', 'success', 'Payée', '10 000'],
                ['Bella Nkoulou', 'warning', 'Prochain', '10 000'],
                ['Carl Mbida', 'destructive', 'En retard', '10 500'],
                ['Dora Fotso', 'muted', 'Suspendu', '—'],
              ].map(([n, v, s, a]) => (
                <TableRow key={n}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Avatar name={n!} size="sm" /> {n}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={v as 'success'}>{s}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {a} <span className="text-xs font-normal text-muted-foreground">XAF</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section id="auth" title="Authentification : étapes, code, mot de passe">
        <Card>
          <CardContent className="grid gap-6 pt-5 md:grid-cols-2">
            <div className="space-y-5">
              <Stepper
                label="Étapes de l’inscription"
                steps={['Inscription', 'Validation', 'Code', 'Mot de passe']}
                current={2}
              />
              <FormField
                id="kit-otp"
                label="Code d’activation"
                description="6 chiffres, collage et remplissage SMS"
              >
                <OtpInput value={otp} onValueChange={setOtp} />
              </FormField>
            </div>
            <FormField id="kit-password" label="Mot de passe">
              <PasswordInput defaultValue="Cigale#Epargne2026" />
            </FormField>
          </CardContent>
        </Card>
      </Section>

      <Section id="etats" title="États : chargement, vide, erreur, succès">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-5">
              <LoadingBlock />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <EmptyState
                icon={<Inbox aria-hidden="true" />}
                title="Aucune tontine"
                description="Créez votre première tontine ou rejoignez-en une."
              />
            </CardContent>
          </Card>
          <Alert variant="destructive" title="Chargement impossible">
            Vérifiez votre connexion puis réessayez.
          </Alert>
          <Alert variant="success" title="C’est fait">
            Votre demande a bien été enregistrée.
          </Alert>
        </div>
      </Section>
    </div>
  );
}
