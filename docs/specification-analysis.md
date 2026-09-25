# Analyse des spécifications

Sources analysées (copiées dans `docs/specs/`) :

| Fichier | Rôle |
|---|---|
| `TontineMoney_UserStories_Detaillees.md` | **Source de vérité fonctionnelle** : 55 user stories, 10 épiques, 8 sprints |
| `TontineMoney_Partie2_Specifications_Fonctionnelles.md` | Machines à états, événements, règles `R-*` des 12 services |
| `TontineMoney_Analyse_Complete.md` | Exigences non fonctionnelles, modèle de données indicatif, sécurité |

En cas de conflit, l'ordre de priorité est : User Stories > Partie 2 > Analyse complète.

## 1. État initial du dépôt

- Dépôt `clauvice74/tontinemoney` : un unique `README.md` (aucun code, aucun test, aucune convention existante).
- Aucune dépendance préexistante. Toutes les conventions sont donc définies dans ce dépôt (voir `CLAUDE.md`, `docs/api-conventions.md`).

## 2. Périmètre

| Épique | Stories | Couverture MVP |
|---|---|---|
| 1 Auth & accès | US-1.1 → 1.6 | Complète (MFA TOTP + SMS simulé) |
| 2 Membres | US-2.1 → 2.6 | Complète |
| 3 KYC | US-3.1 → 3.6 | Pipeline simulé déterministe, revue manuelle, doublons, AML, expiration |
| 4 Tontines rotatives | US-4.1 → 4.10 | Complète (type SIMPLE_ROTATIVE uniquement) |
| 5 Wallet | US-5.1 → 5.6 | Complète |
| 6 Transactions | US-6.1 → 6.6 | Grand livre partie double, compensation, audit, réconciliation |
| 7 Paiements PSP | US-7.1 → 7.6 | Adaptateurs simulés ; interfaces Flutterwave/Paystack préparées, jamais appelées |
| 8 Notifications | US-8.1 → 8.5 | Templates fr/en, heures calmes, retry, DLQ, Mailpit / SMS simulé |
| 9 Conformité | US-9.1 → 9.4 | Catalogue de règles par pays en base, cache, violations |
| 10 Administration | US-10.1 → 10.4 | Complète (V1 : seul le compte principal est fonctionnel) |

Hors périmètre (explicitement V2+ dans les specs) : tontines financières / enchères / immobilières, service de traduction automatique (§12 Partie 2), service Fraude autonome (remplacé par un port simulé), push mobile natif.

## 3. Incohérences et lacunes relevées

Chaque point est tranché dans `docs/assumptions.md` (référence `A-xx`).

| # | Constat | Sources | Décision |
|---|---|---|---|
| I-01 | Deux machines à états se chevauchent : compte utilisateur (`PENDING_APPROVAL`, `PENDING_ACTIVATION`, `ACTIVE_PENDING_KYC`, `REFUSED`…) et membre (`PENDING`, `KYC_REQUIRED`…). US-2.4 utilise `REJECTED`, le diagramme `REFUSED`. | P2 §1.4, §2.3, US-2.4 | A-01 |
| I-02 | US-2.5 compare `memberId` et `userId` du token : implique identité des identifiants. | US-2.5 | A-02 (`member.id = user.id`) |
| I-03 | La création de tontine exige KYC TIER_3 (US-4.1, R-TON-02) mais aucun flux ne produit TIER_3 (le pipeline US-3.2 donne TIER_2). | US-4.1, P2 §3.2 | A-03 |
| I-04 | US-1.1 crée un admin « avec le nom de la tontine associée » sans KYC préalable, alors que R-TON-02 impose TIER_3 au créateur. | US-1.1, R-TON-02 | A-04 |
| I-05 | Statut `READY` : « nombre minimum de membres atteint » sans définir le minimum. | P2 §4.3 | A-05 (min = 3, cf. US-4.3) |
| I-06 | `PAID_LATE`, `PAYOUT_PENDING` absents du modèle de données indicatif mais présents dans les machines à états. | P2 §4.5/4.6, Analyse §5.2 | Machines à états retenues |
| I-07 | Statuts de transaction : le modèle cite `PROCESSING`, la machine à états `VALIDATED`. | P2 §6.3 | Machine à états retenue |
| I-08 | Destination des pénalités non spécifiée. | US-4.5 | A-08 |
| I-09 | Moment du passage `LATE → DEFAULTED` non spécifié. | P2 §4.6 | A-09 |
| I-10 | Paiement partiel vs report : « selon la config » sans valeur par défaut. | US-4.7 | A-10 (défaut : report) |
| I-11 | Conversion de devise non spécifiée. | P2 §5 (notes) | A-11 (rejet `CURRENCY_MISMATCH`) |
| I-12 | TTL des holds proposé dans les notes mais absent des stories. | P2 §5 (notes) | A-12 |
| I-13 | Montants en `DECIMAL(15,2)` incompatibles avec les devises sans décimales (XAF, XOF). | Analyse §5.2 | A-13 (unités mineures `BIGINT`) |
| I-14 | Service Fraude référencé (`fraud.user.flagged`) mais non spécifié. | P2 matrice | A-14 (port simulé) |
| I-15 | Sélection « par vote » en mode `PRIORITY_NEED` non détaillée. | US-4.6 | A-15 (décision admin en V1) |
| I-16 | Le selfie « caméra uniquement » n'est pas vérifiable côté serveur. | US-3.1 | A-16 |
| I-17 | Upload via presigned URL S3 et chiffrement applicatif (R-KYC-05, AES-256). | US-3.1 | A-17 |
| I-19 | L'en-tête annonce 55 user stories ; le document en contient 59 (US-1.1 → US-10.4). | US | Les 59 sont suivies dans `docs/progress.md` |
| I-18 | Les prompts de réalisation fournis sont partiels (sections §7, §8, fin §11, §12, début §13 manquantes). | Prompt | A-00 |

## 4. Risques techniques

| Risque | Impact | Mitigation dans le dépôt |
|---|---|---|
| Double débit / course sur les soldes | Perte financière | Verrous `SELECT … FOR UPDATE` ordonnés, isolation `SERIALIZABLE` + retry, contraintes `CHECK` en base, clés d'idempotence |
| Double traitement de webhook | Double crédit | Table `psp_webhook_events` unique (provider, event_id), vérification signature + horodatage + montant |
| Événement perdu entre écriture et publication | Incohérence inter-domaines | Outbox transactionnel + consommateurs idempotents (`processed_events`) |
| Fuite de données entre membres | Réglementaire | Garde de propriété systématique, tests d'accès croisé |
| Dérive entre soldes et grand livre | Comptable | Invariant partie double testé + job de réconciliation |
| Dépendance à des fournisseurs réels | Sécurité / coût | Tous les fournisseurs derrière des interfaces ; seuls des adaptateurs simulés déterministes sont câblés |
| Infra Docker indisponible en CI/dev | Blocage | Tests d'intégration exécutables sur Postgres natif ou service container GitHub Actions |
