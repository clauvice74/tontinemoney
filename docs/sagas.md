# Sagas et flux interservices

Diagrammes de l'état **cible** (docs/extraction-plan.md, étapes 5 à 7). Sous chaque diagramme, « Aujourd'hui » décrit l'implémentation actuelle du monolithe modulaire. Les noms d'événements cibles portent le suffixe de version du topic (`.v1`) ; la version est aussi dans l'enveloppe (`eventVersion`).

Règles communes : chaque étape écrit son état et ses événements dans **la même transaction SQL** (outbox) ; chaque consommateur est **idempotent** (inbox `processed_events`) ; aucune transaction ACID ne traverse deux services ; toute étape financière a une **compensation**.

## 1. Inscription

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant GW as API Gateway
  participant A as auth-service
  participant M as member-service
  participant W as wallet-service
  participant K as kyc-service
  participant N as notification-service
  C->>GW: POST /api/v1/auth/register
  GW->>A: routage (public, rate limit)
  A-->>C: 202 réponse générique
  A--)M: user.registered.v1
  M--)W: member.created.v1
  M--)K: member.created.v1
  W--)N: wallet.created.v1
  K--)N: kyc.started.v1
  N--)C: instructions (e-mail / SMS)
```

Aujourd'hui : `user.registered` → profil membre → `member.created` → wallet créé dès que le pays est connu. Le dossier KYC est ouvert à la première soumission du membre (pas d'événement `kyc.started`).

## 2. KYC

```mermaid
sequenceDiagram
  autonumber
  participant C as Membre
  participant K as kyc-service
  participant CP as compliance-service
  participant M as member-service
  participant T as tontine-service
  participant N as notification-service
  C->>K: POST /kyc/applications/:id/submit (pièce + selfie)
  K->>K: qualité, OCR, face match, doublons (simulés)
  K--)CP: kyc.submitted.v1
  CP->>CP: AML, PEP, sanctions, pays autorisé
  CP--)K: compliance.screening.completed.v1
  alt aucune alerte
    K--)M: kyc.verified.v1
    K--)T: kyc.verified.v1 (adhésion débloquée)
  else alerte ou score limite
    K--)N: kyc.review.required.v1 (agent KYC)
    Note over K: décision humaine : approve / reject
  end
  M--)N: member.status.changed.v1
  N--)C: résultat
```

Aujourd'hui : le screening AML/PEP/sanctions est une étape du pipeline KYC (fournisseur simulé) ; les correspondances ouvrent un dossier de conformité (`kyc.aml.match`).

## 3. Dépôt

```mermaid
sequenceDiagram
  autonumber
  participant C as Membre
  participant GW as API Gateway
  participant P as payment-service
  participant PSP as PSP simulé
  participant PG as Payment Gateway
  participant TX as transaction-service
  participant W as wallet-service
  participant N as notification-service
  participant R as reporting-service
  C->>GW: POST /payments/deposits (Idempotency-Key)
  GW->>P: routage
  P--)TX: payment.initiated.v1
  P->>PSP: initiation (USSD / 3-D Secure)
  PSP->>PG: webhook signé
  PG->>PG: signature, horodatage, non-rejeu, montant, devise
  PG->>P: résultat normalisé
  P--)TX: payment.completed.v1
  TX--)W: transaction.validated.v1
  W->>W: écritures partie double (clearing PSP → membre)
  W--)TX: wallet.credited.v1
  TX--)N: transaction.completed.v1
  W--)R: wallet.balance.updated.v1
```

Aujourd'hui : webhook reçu par `payments` (`/payments/webhooks/:provider`), puis `payment.completed` → consommateur `settle()` qui appelle `TransactionsService.execute()` en synchrone.

## 4. Contribution

```mermaid
sequenceDiagram
  autonumber
  participant T as tontine-service
  participant C as Membre
  participant TX as transaction-service
  participant CP as compliance-service
  participant W as wallet-service
  participant N as notification-service
  T--)N: contribution.due.v1
  C->>T: POST /contributions/:id/pay (Idempotency-Key)
  T--)TX: contribution.payment.requested.v1
  TX--)CP: transaction.requested.v1
  CP--)TX: compliance.transaction.approved.v1
  TX--)W: transaction.validated.v1 (hold)
  W--)TX: wallet.hold.created.v1
  TX->>W: capture du hold (membre → cagnotte, pénalité → réserve)
  W--)TX: wallet.debited.v1
  TX--)T: transaction.completed.v1
  T->>T: contribution PAID / PAID_LATE
  T--)N: tontine.contribution.received.v1
```

Aujourd'hui : `ContributionsService.pay()` crée le hold et appelle `TransactionsService.execute()` (conformité, capture) en synchrone, sous un verrou par échéance ; en cas d'échec le hold est libéré.

## 5. Paiement du bénéficiaire

```mermaid
sequenceDiagram
  autonumber
  participant T as tontine-service
  participant TX as transaction-service
  participant W as wallet-service
  participant N as notification-service
  participant R as reporting-service
  T--)TX: member.payout.due.v1 (bénéficiaire, montant attendu)
  TX->>TX: vérifie bénéficiaire = celui du cycle
  TX--)W: transaction.validated.v1
  W->>W: débit cagnotte, crédit bénéficiaire (une transaction SQL)
  W--)TX: wallet.debited.v1 + wallet.credited.v1
  TX--)T: payout.completed.v1
  T->>T: cycle.reconciliation.requested.v1
  T--)N: cycle.completed.v1
  T--)R: cycle.completed.v1
```

Aujourd'hui : `PayoutsService.payout()` exécute la transaction `PAYOUT` en synchrone quand la collecte est complète, puis publie `tontine.payout.initiated` et `tontine.cycle.completed`. `member.payout.due` est déjà publié à l'ouverture du cycle.

## 6. Compensation

```mermaid
sequenceDiagram
  autonumber
  participant TX as transaction-service
  participant W as wallet-service
  participant T as tontine-service
  participant N as notification-service
  participant A as admin (alerte)
  Note over TX: erreur à une étape (conformité, fonds, PSP, délai)
  TX--)W: transaction.failed.v1
  W->>W: libération des holds
  W--)TX: wallet.hold.released.v1
  opt écritures déjà passées
    TX--)W: transaction.reversed.v1 (contre-passation)
  end
  TX--)T: transaction.failed.v1 (contribution reste due)
  TX--)N: échec notifié au membre
  opt incohérence persistante
    TX--)A: transaction.reconciliation.failed.v1
  end
```

Aujourd'hui : holds libérés en cas d'échec (`releaseHold`), contre-passation `REVERSAL` par `TransactionsService.reverse()`, remboursement PSP avec reversement interne, holds expirés par job.

## 7. Réconciliation

```mermaid
flowchart LR
  J[Job quotidien] --> I[Interne : soldes projetés = somme du grand livre ?]
  J --> P[PSP : relevé fournisseur = paiements COMPLETED ?]
  I --> D{écart &gt; seuil ?}
  P --> D
  D -- non --> OK[rapport OK]
  D -- oui --> AL[rapport + alerte<br/>transaction.reconciliation.failed.v1]
  AL --> ADM[super-admin : CSV / PDF des écarts]
```

Aujourd'hui : `InternalReconciliationService` et `PspReconciliationService`, rapports `trx_reconciliation_reports`, événement `reconciliation.completed`, déclenchement via `/admin/reconciliation/run` ou `/payments/reconcile`.
