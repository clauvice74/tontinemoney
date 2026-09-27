# Propriété des données

Règle : **seul le service propriétaire lit et écrit ses tables.** Les autres services obtiennent l'information par un port (appel synchrone court en lecture), un événement ou une projection locale.

Depuis l'étape 4 de l'extraction, la règle est **matérialisée et contrôlée** :

1. **un schéma PostgreSQL par service** (`@@schema` dans `schema.prisma`) ; `public` ne contient plus que les extensions et la table de suivi des migrations ;
2. **contrôle statique en CI** (`pnpm arch:check`, `infrastructure/scripts/check-data-ownership.mjs`) : tout accès du code d'un service aux tables d'un autre schéma doit figurer dans `infrastructure/data-ownership.allowlist.json`, avec sa justification et l'étape qui le supprimera ; une entrée devenue inutile fait aussi échouer le contrôle ;
3. **rôles PostgreSQL au moindre privilège** (`pnpm db:roles`, `packages/database/scripts/service-roles.mjs`) : `tm_<schéma>` lit et écrit son schéma, utilise les tables techniques partagées (`platform`), et n'a qu'un droit de **lecture** sur les tables de la liste ; aucune écriture inter-schémas. Vérifié par `apps/api/test/service-roles.e2e-spec.ts`.

## 1. Schémas et tables

| Service               | Schéma            | Tables                                                                                                                                                                    | Rôle                                           |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| (partagé)             | `platform`        | `outbox_events`, `processed_events` (inbox), `event_dead_letters` (rejets consommateurs), `idempotency_keys`, `audit_logs` (ajout seul), `job_runs`                       | — (une copie par service à l'étape 7)          |
| auth-service          | `auth`            | `auth_users`, `auth_password_history`, `auth_tokens`, `auth_refresh_sessions`, `auth_login_attempts`, `auth_recovery_codes`, `auth_known_devices`, `auth_access_requests` | `tm_auth`                                      |
| member-service        | `members`         | `mbr_members`, `mbr_audit_logs`, `mbr_tontine_memberships` (projection des adhésions)                                                                                     | `tm_members`                                   |
| kyc-service           | `kyc`             | `kyc_requests`, `kyc_documents`, `kyc_checks`, `kyc_agent_actions`, `kyc_biometric_templates`, `kyc_duplicate_alerts`, `kyc_aml_matches`, `kyc_aml_whitelist`             | `tm_kyc`                                       |
| compliance-service    | `compliance`      | `cmp_rules`, `cmp_rule_history`, `cmp_violations`, `cmp_cases`, `cmp_case_alerts`                                                                                         | `tm_compliance`                                |
| tontine-service       | `tontines`        | `ton_tontines`, `ton_members`, `ton_invitations`, `ton_cycles`, `ton_contributions`, `ton_priority_requests`, `adm_tontine_accounts`, `adm_messages`                      | `tm_tontines`                                  |
| wallet-service        | `wallets`         | `wal_wallets`, `wal_movements`, `wal_holds`, `wal_status_history`                                                                                                         | `tm_wallets`                                   |
| transaction-service   | `transactions`    | `trx_transactions`, `trx_audit_logs`, `trx_reconciliation_reports`, `trx_sagas`, `trx_saga_steps`, `trx_payment_views` (projection des paiements)                         | `tm_transactions`                              |
| payment-service       | `payments`        | `pay_payments`, `pay_status_history`, `pay_webhook_events`, `pay_sim_operations`                                                                                          | `tm_payments`                                  |
| notification-service  | `notifications`   | `ntf_templates`, `ntf_notifications`                                                                                                                                      | `tm_notifications`                             |
| communication-service | `communication`   | `ntf_outbound_messages` (journal de livraison)                                                                                                                            | `tm_communication`                             |
| admin-service         | `administration`  | `adm_configurations`, `adm_configuration_history`                                                                                                                         | `tm_administration`                            |
| reporting-service     | `reporting`       | projections `rpt_*` (14 tables, alimentées par les instantanés) et `rpt_generated_reports` (rapports archivés)                                                            | `tm_reporting`                                 |
| payment-gateway       | `payment_gateway` | `pgw_webhook_receipts`                                                                                                                                                    | `tm_payment_gateway` (sans accès à `platform`) |

Les noms de tables gardent leur préfixe historique ; `adm_tontine_accounts` et `adm_messages`, écrites uniquement par le service Tontines, appartiennent au schéma `tontines` (A-48).

## 2. Accès inter-schémas tolérés (à supprimer)

Liste exacte, générée à partir de `infrastructure/data-ownership.allowlist.json` (7 accès, tous en lecture) :

| Service      | Schéma lu | Tables / modèles                                                        | Raison                                                                                                                                    | Suppression                                                                               |
| ------------ | --------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| payments     | wallets   | `wallet`                                                                | Wallet du membre (devise, statut) avant l’initiation d’un dépôt ou d’un retrait.                                                          | étape 7 : port de requête wallet-service (règlement déjà via saga, étape 5)               |
| tontines     | wallets   | `wallet`                                                                | Lecture des wallets cagnotte / réserve et du wallet membre (soldes, devise) pendant les opérations de tontine.                            | étape 7 : port de requête wallet-service (écritures déjà via sagas, étape 5)              |
| transactions | wallets   | `wal_holds`, `wal_movements`, `wal_wallets`, `wallet`, `walletMovement` | Orchestrateur des opérations financières : lecture des wallets et mouvements dans la transaction du grand livre ; réconciliation interne. | étape 7 : commandes au wallet-service (le grand livre y reste) ; sagas en place (étape 5) |

Supprimés à l'étape 6 (A-54) : les 17 lectures des rapports et du tableau de bord d'`administration` (reporting-service alimenté par les instantanés publiés par déclencheurs, schéma `reporting`) ; cumuls et solde lus par `compliance` (ports synchrones exacts `TRANSACTION_TOTALS` et `WALLET_QUERY`) ; adhésions lues par `members` (projection `mbr_tontine_memberships`) ; paiements lus par la réconciliation de `transactions` (projection `trx_payment_views`).

Supprimés à l'étape 4 : lectures directes des profils membres par `auth` (`/auth/me`), `kyc` (file de revue, détail, screening, batch AML), `notifications` (coordonnées) et `compliance` (changements de pays), remplacées par les ports `MemberQueryPort` et `RecipientDirectory` ; écritures de `tontines` dans le schéma `administration` (tables rattachées à `tontines`).

## 3. Données sensibles

| Donnée                                                    | Stockage                                                    | Accès                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Mots de passe, OTP, refresh tokens, codes de récupération | hachés (bcrypt / SHA-256), jamais en clair                  | auth-service                                             |
| Documents KYC, selfies                                    | chiffrés (AES-256-GCM) hors répertoire public, clé hors Git | agents KYC et super-admin, lecture journalisée           |
| Coordonnées de retrait                                    | chiffrées, affichage masqué                                 | payment-service                                          |
| Correspondances AML / PEP                                 | tables KYC / conformité                                     | personnel habilité uniquement, jamais le membre concerné |
| Numéro de carte, CVV                                      | **jamais stockés** (saisie sur la page du PSP)              | —                                                        |
