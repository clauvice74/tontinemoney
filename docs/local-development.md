# Développement local

## 1. Avec Docker (configuration de référence)

Prérequis : Node.js ≥ 22, pnpm 10 (`corepack enable`), Docker Desktop (Compose v2).

```bash
cp .env.example .env
pnpm install
docker compose up -d        # PostgreSQL, Redis, Redpanda, MinIO, Mailpit, OTel, Prometheus, Grafana
pnpm db:migrate
pnpm db:seed
pnpm dev                    # API :4000, API Gateway :8080, Payment Gateway :8090, web :3000
```

`EVENT_TRANSPORT=kafka` dans `.env` fait passer les événements par Redpanda au lieu du dispatcher en mémoire.

## 2. Sans Docker

Seul PostgreSQL est indispensable. Redis et l'e-mail passent en mémoire :

```bash
# .env
KV_DRIVER=memory
EMAIL_DRIVER=memory
EVENT_TRANSPORT=inprocess
```

PostgreSQL 16 peut être installé sans droits administrateur à partir des binaires officiels (EnterpriseDB), puis :

```bash
~/.local/opt/pgsql16/bin/pg_ctl -D ~/.local/var/pg16 -l ~/.local/var/pg16.log start
```

Rôle `tontine` / mot de passe `tontine`, bases `tontinemoney` et `tontinemoney_test` (voir `infrastructure/docker/postgres/init.sql`). Non disponibles dans ce mode : Kafka (donc aucun service extrait ne peut tourner dans un processus séparé, A-46), Mailpit, MinIO, Prometheus, Grafana.

## 3. Vérifications

```bash
pnpm check                  # format, lint, typecheck, tests unitaires
pnpm test:int               # intégration API + PostgreSQL (base de test migrée automatiquement)
pnpm build:demo && pnpm test:e2e:local   # Playwright (build avec simulateurs visibles)
```

Pièges :

- Arrêter `pnpm dev` avant `pnpm check`, `pnpm build` ou `pnpm test:e2e:local` : le build Next écrase le `.next/` du serveur de dev et les ports 3000/4000 sont partagés.
- Ne pas charger `.env` dans le shell courant (`set -a; . .env`) : `NODE_ENV=development` fait échouer `next build`. Utiliser un sous-shell.
- Playwright peut utiliser un Chrome installé : `PLAYWRIGHT_CHROMIUM_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
- En mode `pnpm dev`, l'API redémarre à chaque changement de `dist/` ; pour des tests navigateur fiables, préférer `pnpm test:e2e:local`.

## 4. Adresses

| Service                                         | URL                                                      |
| ----------------------------------------------- | -------------------------------------------------------- |
| Web                                             | http://localhost:3000                                    |
| API Gateway (point d'entrée)                    | http://localhost:8080/api/v1 (Swagger : `/api/docs`)     |
| API (service par défaut, derrière le gateway)   | http://localhost:4000                                    |
| Payment Gateway (webhooks PSP)                  | http://localhost:8090/api/v1/webhooks/payments/:provider |
| Santé                                           | `/health`, `/health/ready`, `/metrics`                   |
| Messages simulés                                | http://localhost:3000/dev/messages                       |
| Mailpit · Grafana · Prometheus · MinIO (Docker) | :8025 · :3001 · :9090 · :9001                            |
