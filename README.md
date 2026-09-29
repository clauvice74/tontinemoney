# TontineMoney

Plateforme de gestion de **tontines rotatives** (épargne collective) avec portefeuille électronique, KYC, paiements Mobile Money / carte, conformité par pays et administration. MVP réalisé à partir de `docs/specs/TontineMoney_UserStories_Detaillees.md` (source de vérité fonctionnelle).

> ⚠️ Environnement de **démonstration** : tous les prestataires externes (PSP Mobile Money / carte, SMS, OCR, face matching, AML) sont **simulés et déterministes**. Aucune transaction réelle, aucune donnée KYC réelle, aucun secret réel. Les squelettes Flutterwave / Paystack refusent toute opération.

## Démarrage rapide

Prérequis : Node.js ≥ 22, pnpm 10 (`corepack enable`), Docker (Compose v2).

```bash
cp .env.example .env
pnpm install
docker compose up -d        # PostgreSQL, Redis, Redpanda, MinIO, Mailpit, OTel collector, Prometheus, Grafana
pnpm db:migrate             # migrations SQL versionnées (packages/database/prisma/migrations)
pnpm db:roles               # rôles PostgreSQL par service (moindre privilège)
pnpm db:seed                # comptes et tontine de démonstration
pnpm dev                    # API :4000, API Gateway :8080, Payment Gateway :8090, web :3000
# ou, pour une démonstration stable (services compilés, sans rechargement à chaud) :
pnpm start:demo --build
```

| Service                      | URL                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Application web              | http://localhost:3000                                                         |
| API REST v1 (API Gateway)    | http://localhost:8080/api/v1 — service par défaut `apps/api` sur :4000        |
| Swagger / OpenAPI            | http://localhost:4000/api/docs (JSON : `/api/docs-json`, `docs/openapi.json`) |
| Santé / métriques            | http://localhost:4000/health, `/health/ready`, `/metrics`                     |
| Messages simulés (SMS/email) | http://localhost:3000/dev/messages (codes OTP, liens d'activation)            |
| Mailpit                      | http://localhost:8025                                                         |
| Grafana / Prometheus         | http://localhost:3001 · http://localhost:9090                                 |
| Redpanda Console · Jaeger    | http://localhost:8088 · http://localhost:16686                                |
| Console MinIO                | http://localhost:9001                                                         |

Les clés JWT de développement sont générées automatiquement dans `.keys/` au premier démarrage (ou `pnpm keys:generate`).

## Comptes de démonstration

Mot de passe commun : **`Demo#Tontine2026`**

| Rôle             | Email                                                    | Particularités                                                            |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| SUPER_ADMIN      | `superadmin@tontinemoney.local`                          | MFA SMS obligatoire : code lisible dans « Messages simulés »              |
| KYC_AGENT        | `agent.kyc@tontinemoney.local`                           | File de revue KYC, doublons, correspondances AML                          |
| COMPLIANCE_AGENT | `agent.conformite@tontinemoney.local`                    | Dossiers de conformité, assignation, score de risque, correspondances AML |
| TONTINE_ADMIN    | `admin.tontine@tontinemoney.local`                       | Admin de « Tontine Solidarité Douala » (prête, démarre à la date du seed) |
| MEMBER           | `awa@`, `bello@`, `chantal@`, `david@tontinemoney.local` | KYC niveau 2, portefeuilles alimentés (XAF)                               |
| MEMBER           | `emma@tontinemoney.local`                                | KYC niveau 1 : vérification d'identité requise                            |
| MEMBER           | `felix@tontinemoney.local`                               | Côte d'Ivoire (XOF) : illustre l'incompatibilité de devise                |

Scénarios du simulateur PSP : numéro finissant par `0003` → prestataire indisponible ; `0001` → retrait refusé. Les documents KYC acceptent des marqueurs de simulation (voir `services/kyc/src/providers/providers.ts`).

## Commandes

```bash
pnpm dev                  # API (tsc watch + node --watch) et web (next dev)
pnpm build                # build de tous les packages (turbo)
pnpm build:demo           # build avec les outils de simulation visibles dans le web (NEXT_PUBLIC_ENABLE_SIMULATORS=true)
pnpm start:demo [--build] # lance les services compilés + web (next start), sans rechargement à chaud — démonstration stable
pnpm format | pnpm format:check
pnpm lint                 # ESLint (TypeScript strict, frontières de packages)
pnpm typecheck
pnpm test                 # tests unitaires (Vitest)
pnpm test:int             # tests d'intégration API + PostgreSQL (base tontinemoney_test, migrée automatiquement)
pnpm test:e2e             # Playwright contre un web + API déjà démarrés (E2E_BASE_URL, défaut http://localhost:3000)
pnpm test:e2e:local       # démarre API (dist) + web (next start), exécute Playwright, arrête les serveurs
pnpm check                # format:check + lint + typecheck + test
pnpm db:migrate | pnpm db:migrate:test | pnpm db:migrate:check (dérive schéma ⇄ migrations)
pnpm db:migration:new <nom> | pnpm db:seed | pnpm db:reset
pnpm secrets:scan         # détection de secrets dans les fichiers suivis
pnpm keys:generate        # clés JWT de développement
```

Intégration continue : `.github/workflows/ci.yml` (format, lint, types, tests unitaires, scan de secrets, gitleaks, `pnpm audit`, dérive des migrations, intégration PostgreSQL/Redis avec couverture, E2E Playwright).

## Architecture

Monorepo pnpm + Turborepo. **Monolithe modulaire NestJS** dont chaque domaine est un package indépendant (extraction future en microservices), communiquant par **événements versionnés via outbox** et consommateurs idempotents. Détails : `docs/architecture.md`. **Extraction progressive en microservices en cours** : `docs/extraction-plan.md`.

```
apps/api            hôte NestJS (REST v1, Swagger, santé, métriques, OpenTelemetry)
apps/web            Next.js App Router (TanStack Query, Zustand, RHF + Zod, Tailwind, composants shadcn/ui)
packages/           contracts (schémas zod partagés) · events (catalogue versionné) · auth (crypto, RBAC)
                    database (Prisma 7 + migrations SQL) · platform (outbox, idempotence, audit, gardes, jobs, résilience)
                    config · ui · eslint-config · typescript-config
services/           auth · members · kyc · tontines · wallets · transactions · payments · notifications
                    compliance · administration
infrastructure/     docker (Postgres init) · monitoring (Prometheus, Grafana, OTel) · scripts
docs/               analyse, architecture, modèle de domaine, sécurité, événements, conventions d'API,
                    hypothèses, plan, avancement, routes, OpenAPI
```

Principes financiers : montants en `bigint` (unités mineures), grand livre en **partie double** (`LedgerService`), transactions `SERIALIZABLE` avec rejeu, verrous ordonnés, blocages (holds) avec expiration, contre-passation au lieu de suppression, `Idempotency-Key` obligatoire sur les POST financiers, tables d'audit append-only (triggers), réconciliations interne et PSP quotidiennes.

## Fonctionnalités

59 user stories (10 épiques) — statut détaillé, fichiers, tests et limitations par story dans **`docs/progress.md`**.

- **Accès** : admins créés par le super-admin (délégation de création de tontine), inscription par l'admin, demandes de compte, activation, connexion JWT RS256 + refresh token HttpOnly rotatif (détection de réutilisation), verrouillages, limitation de débit, MFA TOTP/SMS + codes de récupération.
- **Membres** : profil versionné, isolation des données, liste admin (filtres, recherche, masquage), validations, machine à états, détection du pays.
- **KYC** : pièce + selfie caméra (liveness simulée), stockage chiffré AES-256-GCM à identifiants opaques, pipeline qualité → OCR → validation → face match → doublons → AML, revue manuelle (SLA), doublons biométriques, screening AML/PEP/sanctions avec revue humaine obligatoire, expiration et renouvellement, niveau 3, rétention (dry-run).
- **Tontines** : création (règles de pénalité, droit d'entrée, collation), invitations email/téléphone/lien, démarrage automatique avec tirage Fisher-Yates prouvé (SHA-256), ordre fixe, besoin prioritaire, échéances selon la fréquence, retards/pénalités/défauts/suspensions, paiement du pot, report ou paiement partiel, cycles suivants, clôture avec rapport final PDF archivé, tableau de bord, pause/reprise.
- **Portefeuille et transactions** : création automatique, solde/disponible/bloqué, historique, transferts, pipeline de validation (KYC, conformité, fraude simulée, solde), journal d'audit 7 ans, contre-passation, réconciliation.
- **Paiements** : dépôts Mobile Money et carte (3-D Secure simulé), retraits, remboursements, webhooks signés (HMAC, horodatage, anti-rejeu, montant/devise), polling, expiration, disjoncteur, rejeu, repli PSP.
- **Notifications** : modèles fr/en, heures calmes, préférences, file prioritaire, retry + DLQ + repli de canal, rappels J-3/J-1/J, anti-spam.
- **Conformité** : règles dynamiques par pays (effet immédiat, historique), validation synchrone, violations et suspensions.
- **Administration** : demandes d'accès, comptes de tontine, messagerie ciblée, rapports financiers JSON/CSV/PDF, réconciliations, signalement de fraude, tâches planifiées, DLQ, journal d'audit.

## Tests

| Suite                    | Contenu                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitaires (`pnpm test`)  | money, pays, mots de passe, schémas, enveloppes d'événements, crypto/RBAC, config, plateforme, disjoncteur, conformité, statuts membres, calendrier des échéances, tirage, heures calmes, utilitaires web |
| Intégration (`test:int`) | 225 tests API + PostgreSQL : auth, MFA, membres, phase 2, KYC, transactions/conformité, tontines, cycles, paiements, notifications, cycle de vie complet, rapports/réconciliations                        |
| E2E (`test:e2e:local`)   | 9 parcours Playwright : pages publiques, connexion, dépôt Mobile Money simulé, isolation des rôles, agent KYC, admin de tontine, super-admin avec MFA SMS                                                 |

Cas sensibles couverts : accès aux données d'autres membres, double webhook, double débit, solde insuffisant, transactions concurrentes, rotation/réutilisation du refresh token, expiration d'OTP, transitions d'état invalides, pénalités, sélection du bénéficiaire, clôture, réconciliation. Aucun test ne dépend d'un service externe réel.

## Documentation

`docs/specification-analysis.md` · `docs/architecture.md` · `docs/domain-model.md` · `docs/security.md` · `docs/event-catalog.md` · `docs/api-conventions.md` · `docs/api-catalog.md` · `docs/openapi.json` · `docs/assumptions.md` (A-00 → A-46) · `docs/implementation-plan.md` · `docs/progress.md` · `docs/extraction-plan.md` · `docs/service-map.md` · `docs/data-ownership.md` · `infrastructure/data-ownership.allowlist.json` · `docs/sagas.md` · `docs/local-development.md` · `CLAUDE.md`

## Limitations connues

- Prestataires simulés uniquement (PSP, SMS, OCR, face match, liveness, AML) ; Flutterwave/Paystack : squelettes désactivés.
- Monolithe modulaire (transport d'événements in-process par défaut, Kafka/Redpanda disponible via `EVENT_TRANSPORT=kafka`).
- Pas de conversion de devise (A-11) ; pas d'ajout de membre après démarrage (A-06) ; vote des membres (PRIORITY_NEED) hors V1 (A-15).
- Seul le compte principal d'une tontine est fonctionnel (US-10.2) ; purge KYC en dry-run (A-18).
- Tableau de bord rafraîchi par polling (30 s) plutôt que WebSocket ; pas de redimensionnement de photo (A-22) ; pas d'application mobile (notifications push simulées).

## Avant la production

1. Contrats et intégration réels : PSP (Flutterwave/Paystack : clés en coffre-fort, webhooks, relevés), SMS (Twilio), email (SendGrid), KYC (Smile ID/Onfido : OCR, liveness, face match), listes AML officielles.
2. Secrets : KMS / Vault pour `DATA_ENCRYPTION_KEY` et clés JWT (rotation), jamais de fichier `.env`.
3. Revue de sécurité externe et test d'intrusion ; PCI-DSS (périmètre carte chez le PSP), conformité BEAC/BCEAO/RGPD, politique de rétention validée juridiquement.
4. Infrastructure : PostgreSQL managé avec PITR, Redis HA, Kafka managé, stockage objet chiffré, WAF, TLS, sauvegardes testées.
5. Exploitation : alertes Prometheus (DLQ, réconciliation, disjoncteurs), tableaux Grafana, traces OTel, astreinte.
6. Tests de charge et de performance (objectif US-9.2 < 100 ms), revue d'accessibilité complète.
