import { Button, Card, CardContent, CardHeader, CardTitle } from '@tontine/ui';
import { CalendarClock, HandCoins, ScanFace, ShieldCheck, Smartphone, Users } from 'lucide-react';
import Link from 'next/link';

const FEATURES = [
  {
    icon: Users,
    title: 'Tontines rotatives',
    text: 'Créez votre groupe, invitez vos proches, fixez le montant, la fréquence et le mode de tirage.',
  },
  {
    icon: HandCoins,
    title: 'Portefeuille intégré',
    text: 'Déposez par Mobile Money ou carte, cotisez en un clic, recevez votre tour directement.',
  },
  {
    icon: CalendarClock,
    title: 'Échéances et rappels',
    text: 'Calendrier des cotisations, rappels automatiques et suivi des retards et pénalités.',
  },
  {
    icon: ScanFace,
    title: 'Identité vérifiée',
    text: 'Vérification d’identité (KYC) avec selfie en direct pour que chacun sache avec qui il épargne.',
  },
  {
    icon: ShieldCheck,
    title: 'Sécurité et conformité',
    text: 'Double authentification, journal d’audit, règles de conformité par pays.',
  },
  {
    icon: Smartphone,
    title: 'Pensé pour le mobile',
    text: 'Une interface simple et accessible, sur téléphone comme sur ordinateur.',
  },
];

export default function HomePage() {
  return (
    <div>
      <section className="border-b bg-gradient-to-b from-secondary/70 to-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div className="space-y-6">
            <p className="inline-flex rounded-full bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm">
              La tontine, en toute transparence
            </p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Épargnez ensemble, en confiance.
            </h1>
            <p className="max-w-prose text-lg text-muted-foreground">
              TontineMoney digitalise vos tontines rotatives : cotisations suivies, tours de
              versement équitables, portefeuille sécurisé et membres vérifiés.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/login">Se connecter</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/request-account">Demander un compte</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Vous avez reçu un code d’activation ?{' '}
              <Link href="/activate" className="font-medium text-primary underline">
                Activer mon compte
              </Link>
            </p>
          </div>
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>Tontine « Famille Ndjock »</CardTitle>
              <p className="text-sm text-muted-foreground">Cycle 4 sur 10 · mensuelle</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-muted-foreground">Cotisation</p>
                  <p className="text-lg font-semibold tabular-nums">50 000 XAF</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-muted-foreground">Collecté</p>
                  <p className="text-lg font-semibold tabular-nums">400 000 XAF</p>
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>8 cotisations sur 10</span>
                  <span className="font-medium">80 %</span>
                </div>
                <div
                  className="h-2 rounded-full bg-muted"
                  role="img"
                  aria-label="Progression : 80 %"
                >
                  <div className="h-2 w-4/5 rounded-full bg-primary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Exemple illustratif.</p>
            </CardContent>
          </Card>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="fonctionnalites">
        <h2 id="fonctionnalites" className="mb-8 text-2xl font-semibold tracking-tight">
          Tout ce qu’il faut pour une tontine sereine
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <Card key={title}>
              <CardHeader>
                <Icon className="size-6 text-primary" aria-hidden="true" />
                <CardTitle>{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
