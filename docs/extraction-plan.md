# Plan d'extraction en microservices

Décision (2026-09-27, A-45) : **extraction progressive** du monolithe modulaire existant plutôt qu'une réécriture. Chaque étape livre un système exécutable et garde la suite de tests verte (281 tests d'intégration, 9 tests Playwright au départ). Les montants restent des entiers en unités mineures (A-43).

## 1. Point de départ

| Élément du prompt cible                                                                                                         | État au 2026-09-27                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domaines auth, members, kyc, tontines, wallets, transactions, payments, notifications, compliance, administration (+ reporting) | ✅ packages NestJS isolés sous `services/*`, un seul processus hôte `apps/api`                                                                                                                    |
| Routes REST `/api/v1`, OpenAPI                                                                                                  | ✅ 186 opérations, `docs/openapi.json`                                                                                                                                                            |
| Outbox transactionnel, consommateurs idempotents (inbox)                                                                        | ✅ `outbox_events`, `processed_events` ; retry exponentiel ; événements morts consultables                                                                                                        |
| Transport Kafka                                                                                                                 | ✅ `EVENT_TRANSPORT=kafka` (topic = type d'événement) — non exécutable sur ce poste sans Docker                                                                                                   |
| Grand livre en partie double, holds, idempotence, verrous                                                                       | ✅ `LedgerService.post()`, SERIALIZABLE + retry                                                                                                                                                   |
| JWT RS256 + JWKS, refresh rotatif, MFA TOTP/SMS, RBAC + propriété                                                               | ✅                                                                                                                                                                                                |
| API Gateway / Payment Gateway                                                                                                   | API Gateway ✅ (étape 1) ; Payment Gateway ✅ (étape 2)                                                                                                                                           |
| Processus et base logique séparés par service                                                                                   | ⚠️ un processus ; ✅ un schéma PostgreSQL et un rôle par service (étape 4)                                                                                                                        |
| Appels inter-domaines asynchrones                                                                                               | ⚠️ synchrones in-process pour l'argent : `payments → transactions.execute`, `tontines → ledger.createHold / transactions.execute`, `administration` lit les tables des autres domaines (rapports) |
| Enveloppe d'événement : `tenantId`, versions dans le nom du topic                                                               | ⚠️ `tenantId` absent ; topic = `eventType` sans version                                                                                                                                           |
| DLQ côté consommateur (message invalide)                                                                                        | ⚠️ DLQ côté producteur uniquement (outbox `DEAD`)                                                                                                                                                 |
| Rôle `COMPLIANCE_AGENT`, assignation des dossiers                                                                               | ✅ étape 8a (A-49)                                                                                                                                                                                |
| Machine à états transaction PENDING → VALIDATING → VALIDATED → PROCESSING → COMPLETED / FAILED, REVERSING → REVERSED            | ⚠️ PENDING, VALIDATED, COMPLETED, FAILED, REJECTED, REVERSED, REFUNDED                                                                                                                            |
| Redpanda Console, Jaeger, script de création des topics                                                                         | ❌ (Prometheus, Grafana, collecteur OTel présents)                                                                                                                                                |
| Testcontainers                                                                                                                  | ❌ tests d'intégration sur un PostgreSQL local                                                                                                                                                    |

## 2. Prérequis bloquant

Les étapes 3 et suivantes font communiquer **plusieurs processus** par Kafka. Ce poste n'a ni Docker ni Java : aucun broker Kafka/Redpanda ne peut y tourner. Il faut installer **Docker Desktop** (ou Colima) — action de l'utilisateur (droits administrateur). Les étapes 1 et 2 n'en dépendent pas.

## 3. Étapes

Chaque étape se termine par : format, lint, typecheck, tests unitaires et d'intégration, Playwright, mise à jour de `docs/progress.md`, commit.

| #    | Étape                                      | Contenu                                                                                                                                                                                                                                                                                | Kafka requis |
| ---- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 0 ✅ | Plan et contrats                           | Ce document, `service-map.md`, `data-ownership.md`, `sagas.md` (diagrammes), `local-development.md`, hypothèses A-43 à A-46                                                                                                                                                            | non          |
| 1 ✅ | **API Gateway** `apps/api-gateway`         | Point d'entrée unique `/api/v1` : table de routage vers les services, validation JWT par JWKS, rate limiting, correlation ID, Helmet, CORS restrictif, erreurs RFC 9457, journaux, propagation du contexte utilisateur. Aucune règle métier. Au départ, tout est routé vers `apps/api` | non          |
| 2 ✅ | **Payment Gateway** `apps/payment-gateway` | `POST /api/v1/webhooks/payments/:provider` : signature, horodatage, fournisseur, non-rejeu, idempotence, montant, devise, statut ; normalisation ; transmission au service Paiement. Les webhooks ne passent plus par l'API Gateway                                                    | non          |
| 3 ✅ | Enveloppe et fiabilité                     | `tenantId`, topics versionnés `<type>.v<version>`, DLQ côté consommateur (schéma invalide, version non supportée, échecs répétés), script de création des topics, Redpanda Console et Jaeger dans `docker-compose.yml`                                                                 | oui (tests)  |
| 4 ✅ | Schéma PostgreSQL par service              | Déplacement des tables préfixées vers des schémas `auth`, `member`, `kyc`, … ; un rôle PostgreSQL par service limité à son schéma ; migrations par service                                                                                                                             | non          |
| 5 ✅ | Sagas asynchrones                          | Remplacement des appels synchrones inter-domaines par des sagas orchestrées par Transaction Service (dépôt, contribution, paiement du bénéficiaire, compensation) ; machine à états étendue                                                                                            | oui          |
| 6 ✅ | Reporting par projections                  | `reporting-service` alimenté par les événements, sans lecture des tables des autres domaines                                                                                                                                                                                           | oui          |
| 7 ⏳ | Extraction des processus                   | Un processus NestJS par service (`services/*-service`), le gateway route vers chacun ; ordre : payment → reporting → notification/communication → compliance → kyc → tontine → transaction/wallet → member → auth                                                                      | oui          |
| 8 ⚠️ | Compléments                                | Rôle `COMPLIANCE_AGENT`, assignation des dossiers, séparation notification / communication, service admin (configurations), Testcontainers                                                                                                                                             | selon l'item |

Les routes et événements du prompt absents aujourd'hui sont ajoutés dans l'étape du service concerné, en alias quand une route équivalente existe (docs/api-catalog.md).

## 4. Ce qui ne change pas

- Montants : `bigint` en unités mineures (A-43).
- Wallet et grand livre restent dans le même service : la transaction SQL qui verrouille les wallets et écrit les écritures n'est jamais répartie.
- Aucune transaction ACID entre services : cohérence éventuelle contrôlée par sagas et compensation.

### Étape 5 — réalisée (A-53)

Orchestrateur `SagaOrchestrator` (`services/transactions/src/sagas`) : état persistant `trx_sagas`, journal `trx_saga_steps`, réponse `transaction.saga.completed` / `.failed`. Sagas `PAYMENT_SETTLEMENT` (Payment Service n'appelle plus Transaction Service pour régler un dépôt ou un retrait), `CONTRIBUTION` (hold → conformité + capture, compensation par libération du hold), `TONTINE_PAYOUT` et `TONTINE_PAYOUT_TOPUP` (Tontine Service n'appelle plus Transaction Service pour le pot). API : 202 sur le paiement d'une contribution et le paiement forcé ; `PAYOUT_PROCESSING` ; `GET /admin/sagas`. Restent synchrones (A-53) : droit d'entrée, pénalité seule, transfert, remboursement. Lectures de wallets et appel du grand livre en bibliothèque : étape 7 ; cumuls de conformité : étape 6.

### Étape 6 — réalisée (A-54)

Instantanés d'état publiés par déclencheurs dans l'outbox de chaque domaine (14 types `*.snapshot` / `*.recorded`, `packages/database/scripts/cdc-snapshots.mjs`) ; `services/reporting` (schéma `reporting`) : 14 projections versionnées, rapports par tontine et de plateforme, tableau de bord du super-admin, archive des rapports finaux ; ports exacts `TRANSACTION_TOTALS` et `WALLET_QUERY` pour la conformité ; projections locales des adhésions (members) et des paiements (réconciliation). Accès inter-schémas tolérés : 28 → 7, tous des lectures de wallets supprimées à l'étape 7. Reconstruction : `pnpm db:snapshots:republish`.

### Étape 7 — en cours (A-55)

**7a ✅ — fondations et premier service extrait : `apps/reporting-service` (:4100).**

- Transport d'événements `postgres` : l'outbox devient un journal ordonné (`deliverySeq` attribué sous verrou par le relais), chaque service lit depuis sa position (`platform.event_subscriptions`, un groupe par service, bail d'une instance à la fois), via `InboxProcessor` (validation, réessais, rejets). Fonctionne sans Docker ; Kafka reste le transport de production (`KAFKA_GROUP_ID` propre à chaque service).
- Ports à distance : `POST /api/v1/internal/ports/{port}/{méthode}` (liste fermée `REMOTE_PORTS`, HMAC de l'appelant, jamais exposé par le gateway) côté propriétaire ; `RemotePortsModule` côté service extrait (même interface qu'en processus unique, bigint et dates préservés, erreurs métier relayées à l'identique).
- Jetons vérifiés par Auth à chaque requête (port `auth.tokens`) : révocation et changement de rôle immédiats, comme dans le monolithe.
- Monolithe : `EXTRACTED_SERVICES=reporting` retire le module ; gateway : routes `GATEWAY_ROUTES` avec joker de segment (`/api/v1/tontines/*/reports`).
- Ordre révisé : **reporting d'abord** (aucune écriture, uniquement des événements et 4 ports en lecture). Payment-service (initialement premier) exige encore des commandes au wallet-service (blocages de retrait, remboursement synchrone).

**Suite (7b…)** : notification / communication (événements + ports membres, préférences), compliance (port `compliance.assert` à exposer), kyc, tontine, puis transaction + wallet (ensemble : le grand livre ne se répartit pas), member, auth, payment. Prérequis par service : ports appelés à distance ajoutés à `REMOTE_PORTS`, suppression des lectures de wallets restantes (`data-ownership.allowlist.json`), un processus `apps/<service>-service`, routes du gateway, groupe d'événements.
