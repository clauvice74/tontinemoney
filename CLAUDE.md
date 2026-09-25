# CLAUDE.md — TontineMoney

Plateforme de gestion de tontines rotatives (wallet, KYC, paiements, conformité). Monorepo pnpm + Turborepo : API NestJS (monolithe modulaire) + web Next.js.
Spécifications : `docs/specs/TontineMoney_UserStories_Detaillees.md` (source de vérité). Décisions : `docs/assumptions.md`.

## Commandes

```bash
cp .env.example .env
pnpm install
docker compose up -d          # postgres, redis, redpanda, minio, mailpit, prometheus, grafana
pnpm db:migrate               # prisma migrate deploy
pnpm db:seed                  # comptes de démonstration
pnpm dev                      # api :4000 (Swagger /api/docs) + web :3000

pnpm format        # prettier --write     | pnpm format:check
pnpm lint          # eslint (turbo)
pnpm typecheck     # tsc --noEmit (turbo)
pnpm test          # unitaires (vitest)
pnpm test:int      # intégration API + Postgres (DATABASE_URL_TEST)
pnpm test:e2e      # Playwright (web + api démarrés)
pnpm check         # format:check + lint + typecheck + test
pnpm db:generate   # prisma generate après modif du schéma
pnpm db:migration:new <nom>   # nouvelle migration (dev)
```

## Architecture du dépôt

- `apps/api` hôte NestJS ; `apps/web` Next.js App Router.
- `services/<domaine>` : un module NestJS par domaine (auth, members, kyc, tontines, wallets, transactions, payments, notifications, compliance, administration). Chaque package n'exporte que `src/index.ts`.
- `packages/platform` : outbox, bus d'événements, idempotence, audit, gardes, erreurs, horloge.
- `packages/contracts` (zod partagé web/api), `packages/events` (catalogue versionné), `packages/auth` (crypto + RBAC), `packages/database` (Prisma).
- Graphe de dépendances autorisé : `docs/architecture.md` §3. Ne jamais importer un chemin interne d'un autre package.

## Conventions TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` désactivé (Prisma). Pas de `any` (lint error) ; `unknown` + zod à la frontière.
- ESM côté web, CommonJS côté API/packages (compatibilité NestJS).
- Nommage : fichiers `kebab-case.ts`, classes `PascalCase`, tests `*.spec.ts` (unitaires) / `*.e2e-spec.ts` (API).
- Validation des entrées uniquement via schémas zod de `packages/contracts` + `ZodValidationPipe`.
- Erreurs : lever `DomainError(code, …)` ; le filtre les convertit en Problem Details.

## Règles de sécurité

- Toute route : `@Roles()` explicite ou `@Public()` ; contrôle de **propriété** en plus du rôle (`TontineAccessService`, `assertSelfOrRole`).
- Jamais de secret, jeton, OTP ou document dans un log, un événement ou une réponse (sauf affichage unique des codes de récupération MFA).
- Messages d'erreur d'authentification génériques.
- Données KYC : chiffrées, identifiants opaques, accès `KYC_AGENT`/`SUPER_ADMIN` journalisé.

## Règles financières

- Montants : `bigint` en unités mineures (`*Minor`), jamais de `number` flottant. Conversion via `Money` (`packages/contracts`).
- Toute écriture monétaire passe par `LedgerService.post()` (partie double, verrous ordonnés, SERIALIZABLE + retry). Jamais d'`UPDATE` direct de solde ailleurs.
- `Idempotency-Key` obligatoire sur les POST financiers.
- Aucune suppression/modification d'écriture : contre-passation (REVERSAL).
- Devise unique par opération ; sinon `CURRENCY_MISMATCH`.

## Événements

Publier uniquement via `OutboxService.add(tx, event)` dans la même transaction Prisma. Consommateurs : `@OnEvent('type', { consumer: 'nom' })` — idempotents par construction (`processed_events`). Nouveau type → l'ajouter à `packages/events/src/catalog.ts` et à `docs/event-catalog.md`.

## Définition de terminé

Code + migration + autorisations + validation + erreurs + événements + idempotence si requise + tests verts + OpenAPI + écran web + critères d'acceptation tracés dans `docs/progress.md` + aucun secret réel.

## Obligations

- **Interdiction d'utiliser des secrets, identifiants, documents KYC, cartes ou transactions réels.** Uniquement les adaptateurs simulés.
- **Mettre à jour `docs/progress.md`** (statut, fichiers, tests, critères, limitations) à chaque story modifiée, et `docs/assumptions.md` pour toute nouvelle hypothèse.
- Ne jamais désactiver un test ou une règle de lint pour obtenir un résultat vert.
