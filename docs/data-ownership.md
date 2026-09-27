# Propriété des données

Règle : **seul le service propriétaire lit et écrit ses tables.** Les autres services obtiennent l'information par événement (projection locale) ou par un appel synchrone court en lecture.

## 1. Tables par service

| Service cible        | Schéma cible   | Tables actuelles (schéma `public`)                                                                                                                                        |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth-service         | `auth`         | `auth_users`, `auth_password_history`, `auth_tokens`, `auth_refresh_sessions`, `auth_login_attempts`, `auth_recovery_codes`, `auth_known_devices`, `auth_access_requests` |
| member-service       | `member`       | `mbr_members`, `mbr_audit_logs`                                                                                                                                           |
| kyc-service          | `kyc`          | `kyc_requests`, `kyc_documents`, `kyc_checks`, `kyc_agent_actions`, `kyc_biometric_templates`, `kyc_duplicate_alerts`, `kyc_aml_matches`, `kyc_aml_whitelist`             |
| compliance-service   | `compliance`   | `cmp_rules`, `cmp_rule_history`, `cmp_violations`, `cmp_cases`, `cmp_case_alerts`                                                                                         |
| tontine-service      | `tontine`      | `ton_tontines`, `ton_members`, `ton_invitations`, `ton_cycles`, `ton_contributions`, `ton_priority_requests`                                                              |
| wallet-service       | `wallet`       | `wal_wallets`, `wal_movements`, `wal_holds`, `wal_status_history`                                                                                                         |
| transaction-service  | `transaction`  | `trx_transactions`, `trx_audit_logs`, `trx_reconciliation_reports`                                                                                                        |
| payment-service      | `payment`      | `pay_payments`, `pay_status_history`, `pay_webhook_events`, `pay_sim_operations`                                                                                          |
| notification-service | `notification` | `ntf_templates`, `ntf_notifications`, `ntf_outbound_messages`                                                                                                             |
| admin-service        | `admin`        | `adm_tontine_accounts`, `adm_messages`, `adm_reports`                                                                                                                     |
| chaque service       | son schéma     | `outbox_events`, `processed_events` (inbox), `idempotency_keys`, `audit_logs`, `job_runs` — une copie par service après l'étape 4                                         |

## 2. Lectures inter-domaines existantes (à supprimer)

| Lecteur                                                 | Données d'autrui lues                                         | Remplacement prévu                                                |
| ------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `administration` (rapports tontine et plateforme, A-28) | `trx_*`, `pay_*`, `wal_*`, `ton_*`, `mbr_*`, `kyc_*`, `cmp_*` | projections de `reporting-service` (étape 6)                      |
| `members` (annuaire d'une tontine)                      | `ton_members`                                                 | projection des adhésions via `tontine.member.added` / `removed`   |
| `kyc` (screening quotidien, statut)                     | `mbr_members`                                                 | port de lecture `MemberQueryPort` (appel synchrone) ou projection |
| `compliance` (cumuls des plafonds)                      | `trx_transactions`                                            | projection des transactions réalisées via `transaction.completed` |
| `wallets`, `tontines`, `payments`                       | appels in-process à `LedgerService` / `TransactionsService`   | sagas asynchrones (étape 5)                                       |

## 3. Données sensibles

| Donnée                                                    | Stockage                                                    | Accès                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Mots de passe, OTP, refresh tokens, codes de récupération | hachés (bcrypt / SHA-256), jamais en clair                  | auth-service                                             |
| Documents KYC, selfies                                    | chiffrés (AES-256-GCM) hors répertoire public, clé hors Git | agents KYC et super-admin, lecture journalisée           |
| Coordonnées de retrait                                    | chiffrées, affichage masqué                                 | payment-service                                          |
| Correspondances AML / PEP                                 | tables KYC / conformité                                     | personnel habilité uniquement, jamais le membre concerné |
| Numéro de carte, CVV                                      | **jamais stockés** (saisie sur la page du PSP)              | —                                                        |
