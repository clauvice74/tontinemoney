# Modèle de domaine

Le schéma de référence est `packages/database/prisma/schema.prisma` ; les contraintes qui ne s'expriment pas en Prisma (CHECK, triggers append-only, index trigram) sont dans les migrations SQL. Conventions : un schéma PostgreSQL par service (docs/data-ownership.md, A-48), tables `snake_case` préfixées par domaine, colonnes `camelCase`, identifiants UUID v4, horodatages `timestamptz`, montants `BIGINT` en unités mineures suffixés `Minor` (A-13).

## 1. Carte des agrégats par domaine

| Domaine        | Tables (propriétaire exclusif en écriture)                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| platform       | `outbox_events`, `processed_events`, `idempotency_keys`, `audit_logs`, `job_runs`                                                                                         |
| auth           | `auth_users`, `auth_password_history`, `auth_tokens`, `auth_refresh_sessions`, `auth_login_attempts`, `auth_recovery_codes`, `auth_known_devices`, `auth_access_requests` |
| members        | `mbr_members`, `mbr_audit_logs`                                                                                                                                           |
| kyc            | `kyc_requests`, `kyc_documents`, `kyc_checks`, `kyc_agent_actions`, `kyc_biometric_templates`, `kyc_duplicate_alerts`, `kyc_aml_matches`, `kyc_aml_whitelist`             |
| tontines       | `ton_tontines`, `ton_members`, `ton_invitations`, `ton_cycles`, `ton_contributions`, `ton_priority_requests`                                                              |
| wallets        | `wal_wallets`, `wal_movements`, `wal_holds`, `wal_status_history`                                                                                                         |
| transactions   | `trx_transactions`, `trx_audit_logs`, `trx_reconciliation_reports`                                                                                                        |
| payments       | `pay_payments`, `pay_status_history`, `pay_webhook_events`                                                                                                                |
| notifications  | `ntf_templates`, `ntf_notifications`, `ntf_outbound_messages`                                                                                                             |
| compliance     | `cmp_rules`, `cmp_rule_history`, `cmp_violations`, `cmp_cases`, `cmp_case_alerts`                                                                                         |
| administration | `adm_tontine_accounts`, `adm_messages`                                                                                                                                    |

## 2. Machines à états

### Compte utilisateur (A-01)

```
PENDING_APPROVAL ─approve─► PENDING_ACTIVATION ─activate─► ACTIVE ─suspend─► SUSPENDED ─lift─► ACTIVE
        │ reject / 30 j                                        │ deactivate
        ▼                                                      ▼
  REJECTED / EXPIRED                                        INACTIVE
```

Verrouillage temporaire (échecs de connexion) : champ `lockedUntil`, indépendant du statut.

### Membre

Matrice US-2.6, implémentée dans `services/members/src/domain/member-status.ts` (fonction pure `transition(status, event)`). Transitions invalides : ignorées et journalisées.

| Événement                                         | Depuis                      | Vers           |
| ------------------------------------------------- | --------------------------- | -------------- |
| profil complet                                    | PENDING                     | KYC_REQUIRED   |
| `kyc.submitted`                                   | KYC_REQUIRED, KYC_REJECTED  | KYC_IN_REVIEW  |
| `kyc.review.required`                             | KYC_REQUIRED                | KYC_IN_REVIEW  |
| `kyc.verified`                                    | KYC_REQUIRED, KYC_IN_REVIEW | ACTIVE         |
| `kyc.rejected`                                    | KYC_IN_REVIEW               | KYC_REJECTED   |
| `kyc.duplicate.detected`                          | tout sauf SUSPENDED         | PENDING_REVIEW |
| `fraud.user.flagged`, `compliance.user.suspended` | tout sauf SUSPENDED         | SUSPENDED      |
| levée de suspension (admin)                       | SUSPENDED                   | ACTIVE         |

### KYC

`SUBMITTED → PROCESSING → VERIFIED | REVIEW_REQUIRED | REJECTED` ; `REVIEW_REQUIRED → VERIFIED | REJECTED | SUPPLEMENT_REQUESTED` ; `VERIFIED → EXPIRED` ; `REJECTED/EXPIRED/SUPPLEMENT_REQUESTED → (nouvelle demande) SUBMITTED`. Une seule demande ouverte par membre (index unique partiel).

### Tontine

`DRAFT ⇄ READY → ACTIVE ⇄ PAUSED → COMPLETED` ; `DRAFT|READY → CANCELLED`.

### Cycle

`PENDING → IN_PROGRESS → PAYOUT_PENDING → COMPLETED`.

### Contribution

`PENDING → PAID` ; `PENDING → LATE → PAID_LATE | DEFAULTED` ; `DEFAULTED → PAID_LATE` (régularisation tardive autorisée).

### Wallet

`ACTIVE ⇄ SUSPENDED`, `ACTIVE ⇄ LOCKED`, `LOCKED → CLOSED`, `SUSPENDED → CLOSED` (solde 0 et aucun hold actif). Historique dans `wal_status_history`.

### Transaction

`PENDING → VALIDATED | REJECTED` ; `VALIDATED → COMPLETED | FAILED` ; `COMPLETED → REVERSED` ; `FAILED → REFUNDED`.

### Paiement

`PENDING → PROCESSING → COMPLETED | FAILED | EXPIRED | CANCELLED` ; `COMPLETED → REFUNDED`.

## 3. Grand livre (partie double)

Tout solde est porté par un **wallet**. Types de propriétaires (`ownerType`) :

| ownerType         | Rôle                                                     | Solde négatif                             |
| ----------------- | -------------------------------------------------------- | ----------------------------------------- |
| `MEMBER`          | Wallet d'un membre (un par membre, devise du pays)       | interdit                                  |
| `TONTINE_POOL`    | Cagnotte d'une tontine (contributions du cycle en cours) | interdit                                  |
| `TONTINE_RESERVE` | Pénalités et droits d'entrée d'une tontine (A-08)        | interdit                                  |
| `SYSTEM`          | Comptes techniques par devise : `PSP_CLEARING`, `FEES`   | autorisé (contrepartie des flux externes) |

Écritures par type de transaction :

| Transaction                       | Débit                                     | Crédit                |
| --------------------------------- | ----------------------------------------- | --------------------- |
| DEPOSIT (dépôt PSP confirmé)      | `SYSTEM:PSP_CLEARING`                     | `MEMBER`              |
| WITHDRAWAL (retrait PSP confirmé) | `MEMBER` (capture du hold)                | `SYSTEM:PSP_CLEARING` |
| TRANSFER                          | `MEMBER` A                                | `MEMBER` B            |
| CONTRIBUTION                      | `MEMBER`                                  | `TONTINE_POOL`        |
| PENALTY, ENTRY_FEE                | `MEMBER`                                  | `TONTINE_RESERVE`     |
| PAYOUT                            | `TONTINE_POOL`                            | `MEMBER` bénéficiaire |
| COLLATION                         | `TONTINE_POOL`                            | `TONTINE_RESERVE`     |
| REFUND                            | `MEMBER`                                  | `SYSTEM:PSP_CLEARING` |
| REVERSAL                          | inverse exact de la transaction d'origine |

Invariants testés :

1. Pour toute transaction `COMPLETED`, Σ débits = Σ crédits.
2. Pour tout wallet, `balanceMinor = Σ crédits − Σ débits` de ses mouvements.
3. `blockedMinor = Σ holds ACTIVE`.
4. `balanceMinor ≥ 0` et `0 ≤ blockedMinor ≤ balanceMinor` pour les wallets non système (CHECK SQL).
5. Aucune ligne de `wal_movements`, `trx_audit_logs`, `audit_logs` n'est modifiable ni supprimable (trigger).

## 4. Référentiels statiques (`packages/contracts`)

- Pays : code ISO, indicatif E.164, devise, langue, fuseau, types de documents KYC acceptés (CM, CI, NG, CD, SN, GA, FR, CA, …).
- Devises : exposant ISO 4217.
- Catalogue initial des règles de conformité (P2 §10.2), chargé en base par le seed puis modifiable (US-9.3).
