# Hypothèses

Règle appliquée (prompt §1) : en cas d'information manquante, option la plus simple et la plus sûre, abstraction configurable, documentation ici. Chaque hypothèse est référencée dans le code par son identifiant (`A-xx`) lorsque pertinent.

## A-00 — Prompt de réalisation partiel

Les sections §7 (exigences financières), §8, la fin de §11 (frontend), §12 et le début de §13 du prompt n'ont pas été transmises. Les règles financières retenues sont les pratiques standard les plus conservatrices :

- montants en unités mineures entières (`BIGINT`), jamais de flottants ;
- grand livre en partie double : chaque transaction complétée produit des écritures dont la somme des débits égale la somme des crédits ;
- aucun solde négatif (contrainte base de données) ;
- holds avant tout débit différé ;
- clé d'idempotence obligatoire sur toute opération financière initiée par un client ;
- isolation `SERIALIZABLE` pour débits et transferts, retry borné sur conflit de sérialisation ;
- aucune suppression d'écriture financière (tables append-only, corrections par contre-passation).

## A-01 — Statuts du compte utilisateur vs statuts du membre

Deux entités distinctes :

- `User.status` (domaine Auth) : `PENDING_APPROVAL`, `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `REJECTED`, `EXPIRED`, `INACTIVE`.
  `REFUSED` (diagramme) ≡ `REJECTED` (US-2.4). `ACTIVE_PENDING_KYC` n'est pas stocké : c'est l'état dérivé « `User.status = ACTIVE` et `Member.status ≠ ACTIVE` ». L'API l'expose sous le champ calculé `accessState`.
- `Member.status` (domaine Membres) : `PENDING`, `KYC_REQUIRED`, `KYC_IN_REVIEW`, `KYC_REJECTED`, `ACTIVE`, `SUSPENDED`, plus `PENDING_REVIEW` (blocage doublon biométrique, US-3.4).

## A-02 — Identifiant commun

`Member.id = User.id`. Le profil membre est créé de façon asynchrone par le consommateur de `user.registered` (US-2.1) ; les tables qui référencent un membre avant la création du profil (adhésion pré-associée US-1.2) référencent `users.id`.

## A-03 — Obtention du niveau KYC TIER_3

Aucun flux automatique ne produit TIER_3. En V1 : un membre TIER_2 soumet une demande de niveau 3 (justificatif de domicile + déclaration de source de revenus) qui passe **toujours** en revue manuelle par un `KYC_AGENT`. La vérification vidéo live est un adaptateur simulé. Les comptes de démonstration incluent des membres TIER_3.

## A-04 — Admin de tontine créé par le super-admin (US-1.1)

Le super-admin crée le compte et une tontine `DRAFT` portant le nom fourni, dont l'admin est propriétaire. L'exigence TIER_3 (R-TON-02) s'applique aux créations en libre-service (US-4.1), pas aux créations déléguées par le super-admin. En revanche, pour **démarrer**, tous les participants, admin inclus, doivent être KYC ≥ TIER_2 (R-TON-01). L'admin est aussi participant de la tontine.

## A-05 — Passage DRAFT → READY

Transition automatique dès que le nombre de participants confirmés ≥ 3 (minimum de US-4.3). Retour automatique en `DRAFT` si le nombre repasse sous 3 avant démarrage. Les invitations restent possibles en `READY` jusqu'à `maxMembers`.

## A-06 — Rattrapage des nouveaux membres en cours de tontine (P2 §4.3 flux 5)

Hors V1 : l'ajout de membres est interdit après démarrage (`ACTIVE`). Documenté comme limitation.

## A-07 — Contributions payées depuis le wallet

Une contribution est réglée par débit du wallet du membre (hold puis capture). Le membre alimente d'abord son wallet par dépôt Mobile Money ou carte (simulé). Aucun paiement PSP direct vers la cagnotte.

## A-08 — Destination des pénalités

Les pénalités sont dues en plus de la contribution. Elles sont créditées au compte de réserve de la tontine (`TONTINE_RESERVE`), jamais au bénéficiaire du cycle, et apparaissent dans les rapports. Leur redistribution est hors V1 : à la clôture, le solde de réserve est signalé dans le rapport final.

## A-09 — Passage LATE → DEFAULTED

Une contribution `LATE` devient `DEFAULTED` lorsqu'elle reste impayée `defaultAfterDays` jours après l'échéance + grâce (défaut : 7, configurable par tontine). Le compteur de défauts consécutifs (R-TON-05, `suspendAfter`) compte les contributions `LATE` ou `DEFAULTED` consécutives d'un membre.

## A-10 — Contributions incomplètes à l'échéance

Paramètre `incompletePolicy` de la tontine : `POSTPONE` (défaut, plus sûr) ou `PARTIAL_PAYOUT`. En `POSTPONE`, le cycle attend ; l'admin peut forcer un paiement partiel explicite (action journalisée).

## A-11 — Devises

Pas de conversion en V1 : toute opération entre wallets de devises différentes est rejetée avec `CURRENCY_MISMATCH`. Une tontine a une devise unique ; seuls les membres dont le wallet est dans cette devise peuvent y adhérer (critère « pays compatible » d'US-4.2).

## A-12 — Expiration des holds

`WalletHold.expiresAt` obligatoire. TTL par contexte : contribution 15 min, transfert 1 h, retrait 24 h, défaut 24 h (configurables). Job minute avec `FOR UPDATE SKIP LOCKED` ; événement `wallet.hold.expired`.

## A-13 — Représentation monétaire

Base : `BIGINT` en unités mineures ISO 4217 (XAF/XOF : 0 décimale ; NGN, USD, EUR, CAD : 2). API : chaîne décimale en unités majeures (`"50000"`, `"12.50"`) + code devise ; tout montant avec plus de décimales que la devise n'en autorise est rejeté (400).

## A-14 — Service Fraude

Non spécifié : remplacé par un `FraudScoringPort` simulé (score 0 sauf règles déterministes de test) et une action super-admin « signaler une fraude » qui émet `fraud.user.flagged`.

## A-15 — Mode PRIORITY_NEED

Les membres soumettent une demande motivée ; l'admin désigne le bénéficiaire parmi les demandeurs non encore servis. Le vote des membres est hors V1. Si aucune demande, l'admin choisit parmi les non-bénéficiaires.

## A-16 — Selfie caméra

Le frontend impose `getUserMedia` (pas de sélecteur de fichier). Le serveur exige `captureSource = CAMERA` et un `livenessToken` émis par l'adaptateur de liveness (simulé). La garantie réelle dépend d'un fournisseur KYC.

## A-17 — Stockage des documents KYC

Interface `DocumentStorage` : adaptateur `local` (disque, répertoire hors public) et adaptateur `s3` (MinIO en local). Les fichiers sont chiffrés au niveau applicatif (AES-256-GCM, clé de dev générée) **avant** stockage, référencés par identifiant opaque. L'upload passe par l'API (multipart) en V1 plutôt que par presigned URL, afin que le chiffrement applicatif soit garanti ; l'interface prévoit `createPresignedUpload` pour une évolution.

## A-18 — Politique de rétention

Documents KYC et historique : 7 ans (`retentionUntil` calculé). Tontines clôturées : 5 ans. Un job de purge est fourni en mode _dry-run_ uniquement (aucune suppression automatique en V1).

## A-19 — Captcha

Interface `CaptchaVerifier`. Adaptateur simulé : tout jeton est accepté sauf `"fail"` (qui simule un bot → rejet silencieux, US-1.3).

## A-20 — Pays détecté depuis l'IP

Interface `GeoIpResolver`. Adaptateur simulé : en-tête `x-dev-country` en dev, sinon inconnu. Priorité de résolution : KYC > profil > téléphone > IP (US-9.1).

## A-21 — Indicatif +1

`+1` → `CA` par défaut (US-2.1), langue `fr-CA`, fuseau `America/Toronto`.

## A-22 — Redimensionnement de la photo de profil

Interface `ImageProcessor`. Validation stricte (JPEG/PNG par signature binaire, ≤ 5 Mo). Adaptateur par défaut : pas de redimensionnement (stockage tel quel). Le redimensionnement 400×400 nécessite un adaptateur `sharp` à activer.

## A-23 — Rôles multiples

Un utilisateur a un rôle plateforme (`SUPER_ADMIN`, `KYC_AGENT`, `MEMBER`). `TONTINE_ADMIN` est porté soit comme rôle plateforme (comptes créés en US-1.1), soit par l'adhésion `TontineMember.role = ADMIN`. L'autorisation d'administrer une tontine vérifie toujours l'adhésion ADMIN à **cette** tontine (propriété de ressource), jamais le seul rôle.

## A-24 — Refresh token

Transmis au navigateur uniquement en cookie `HttpOnly; Secure; SameSite=Strict` (`tm_rt`, chemin `/api/v1/auth`). Pour les clients non navigateurs (tests, mobile futur), il est aussi accepté dans le corps de `POST /auth/refresh` ; il n'est jamais renvoyé dans le corps des réponses.

## A-25 — Envoi SMS

Adaptateur `SmsProvider` simulé : écrit les messages dans la table `outbound_messages` et dans les logs (valeurs sensibles masquées) ; consultable dans la console dev `/dev/sms` (désactivée en production). Email : SMTP vers Mailpit.

## A-26 — Clés JWT

En dev, si aucune clé n'est fournie, une paire RSA est générée au démarrage et persistée dans `.keys/` (ignoré par git). JWKS publié sur `/.well-known/jwks.json`. Rotation : plusieurs clés acceptées, une seule active (`kid`).

## A-27 — Calendrier

Toutes les échéances sont calculées en date civile dans le fuseau du **créateur** de la tontine ; les rappels sont envoyés dans le fuseau de chaque membre (R-NOT-03). BIMONTHLY = le 15 et le dernier jour du mois (le « 30 » de février devient le 28/29).

## A-28 — Service Rapports / CQRS

En monolithe modulaire, les rapports lisent des vues de lecture dédiées (requêtes en lecture seule sur les tables du domaine) exposées par chaque module. Les vues matérialisées alimentées par événements sont une évolution documentée.

## A-29 — Expiration d'une pièce d'identité (US-3.6)

À J-0 les opérations financières sont suspendues (`kyc.operations.suspended`) mais le niveau `TIER_2` est conservé 30 jours pour permettre le renouvellement sans perdre l'historique ; à J+30 sans renouvellement, le niveau redescend à `TIER_1`.

## A-30 — Devise d'une tontine (US-4.1)

La devise est pré-remplie selon le pays du créateur et reste modifiable dans le formulaire, mais comme l'admin est aussi participant (A-04) et qu'aucune conversion n'existe (A-11), elle doit être égale à la devise de son portefeuille ; sinon `CURRENCY_MISMATCH`. La collation par tour doit rester inférieure au pot minimal (3 contributions).

## A-31 — Invitations (US-4.2)

Toute invitation porte un code secret (seul son SHA-256 est stocké). Un seul lien partageable actif par tontine (un nouveau lien révoque le précédent) ; il est multi-usage jusqu'à expiration (7 jours) ou jusqu'à ce que la capacité soit atteinte. Une invitation email/téléphone n'est acceptable que par la personne ciblée. Si l'invité n'est pas éligible, l'acceptation est refusée (422 avec motifs) et l'invitation reste en attente, pour qu'il puisse réessayer après avoir complété son KYC. L'aperçu d'un lien (`GET /invitations/code/{code}`) est public et n'expose que les informations déjà contenues dans l'invitation.

## A-32 — Délégation de création (A-04, précision)

Le super-admin ne crée pas la tontine lui-même (les paramètres financiers appartiennent à l'admin) : il crée le compte avec le nom de tontine délégué. L'admin crée ensuite UNE tontine sans l'exigence TIER_3 ; la délégation est consommée atomiquement avec la création (port `ADMIN_DELEGATION` implémenté par Auth).

## A-33 — Première échéance

La première échéance est la première occurrence de la règle de fréquence **strictement postérieure** à la date de début : si la tontine démarre un mercredi « 1er du mois », la 1re échéance est le 1er mercredi du mois suivant. Les membres ont toujours au moins un jour pour cotiser.

## A-34 — Règlement des paiements PSP

Le passage d'un paiement à `COMPLETED` (webhook ou polling) et le crédit du wallet sont découplés : `payment.completed` est publié dans l'outbox et son consommateur (`payments.settlement`) exécute la transaction interne idempotente (`payment:{id}`). Un crash entre les deux est rattrapé par le relais ; un écart persistant est signalé par la réconciliation (`PAYMENT_WITHOUT_TRANSACTION`). Un webhook dont le montant ou la devise diffère n'est jamais appliqué (`AMOUNT_MISMATCH`, audit).

## A-35 — PSP simulé

Deux instances du simulateur (`simulated`, `simulated-backup`) permettent de démontrer le repli. Scénarios déterministes : numéro finissant par `0003` → prestataire indisponible ; `0001` → versement refusé. La confirmation USSD et la page 3-D Secure sont servies par l'API (`/api/v1/psp-sim/*`, désactivées en production). Les retraits en attente sont réglés automatiquement après 30 s par une tâche du simulateur.

## A-36 — Concurrence sur une échéance

Un verrou applicatif atomique (KV `incr` + TTL 60 s) garantit un seul paiement en cours par contribution ; les requêtes concurrentes reçoivent `409 IDEMPOTENCY_IN_PROGRESS`. Le grand livre reste la garantie finale (SERIALIZABLE, clés d'idempotence du hold et de la transaction).

## A-37 — Emplacement des comptes de tontine (US-10.2)

Les comptes de tontine sont une configuration de la tontine : ils sont gérés par le module Tontines (et non Administration) pour éviter une dépendance circulaire. Le compte principal est créé avec la tontine.

## A-38 — PRIORITY_NEED au démarrage

En mode besoin prioritaire, la tontine démarre sans bénéficiaire désigné pour le cycle 1 (`firstBeneficiaryId = null`) ; l'admin désigne ensuite le bénéficiaire (US-4.6). Le paiement du pot exige une désignation (`PAYOUT_NOT_READY`).

## A-39 — Collation

La collation par tour est déduite du pot versé au bénéficiaire et créditée au compte de réserve de la tontine (contexte `COLLATION`), comme les pénalités (A-08). Si le montant collecté ne couvre pas la collation, aucune collation n'est prélevée.

## A-40 — Paiements partiels et arriérés

Après un paiement partiel (politique `PARTIAL_PAYOUT` ou décision de l'admin), les arriérés payés plus tard sont immédiatement reversés au bénéficiaire du cycle concerné (transaction `PAYOUT` idempotente `payout-topup:{contribution}`). Un paiement bloqué par la conformité passe le cycle en `PAYOUT_PENDING` (audit) ; l'admin peut relancer par le paiement forcé.

## A-41 — Score de risque d'un membre

Les spécifications ne définissent pas de score de risque. `POST /risk-score` (alias `/fraud/analyze`) calcule un indicateur 0–100 **en lecture seule** pour le personnel, sans aucune action automatique. Pondérations (`services/compliance/src/domain/risk.ts`) : niveau KYC (NONE 25, TIER_1 15, TIER_2 5, TIER_3 0) ; chaque dossier de conformité ouvert selon sa gravité (LOW 5, MEDIUM 15, HIGH 30, CRITICAL 50) ; violations des 30 derniers jours (3 points chacune, plafond 15) ; statut de conformité RESTRICTED / UNDER_REVIEW +10, NON_COMPLIANT / SUSPENDED +20 ; compte suspendu +10. Niveaux : < 25 LOW, < 50 MEDIUM, < 75 HIGH, sinon CRITICAL. **À valider par la conformité avant production.**

## A-42 — Dossiers de conformité

Un dossier (`cmp_cases`) regroupe les alertes d'un membre par type : `AML_SCREENING` (correspondances AML/PEP/sanctions), `DUPLICATE_IDENTITY`, `RULE_VIOLATION`, `FRAUD`. Un seul dossier ouvert par membre et par type (index partiel) ; il est alimenté par les événements `kyc.aml.match`, `kyc.duplicate.detected`, `compliance.violation.detected` et `fraud.user.flagged`, de façon idempotente. Gravité : PEP MEDIUM, sanction HIGH (CRITICAL si score ≥ 90), doublon HIGH, fraude CRITICAL, violations LOW → MEDIUM (3) → HIGH (5, seuil de suspension US-9.4) ; elle ne diminue jamais. La clôture (`CONFIRMED` ou `DISMISSED`, commentaire obligatoire) est refusée tant qu'une correspondance AML ou une alerte doublon du dossier n'a pas été tranchée dans la revue KYC, qui reste le seul circuit de décision sur ces alertes. Clore un dossier ne lève aucune suspension.

## A-43 — Montants : entiers en unités mineures plutôt que Decimal

Le prompt d'extraction demande des montants `Decimal`. Le projet utilise `BIGINT` en unités mineures (A-13), aussi sûr (aucun flottant, arithmétique exacte), déjà couvert par les tests et imposé par `CLAUDE.md`. Décision de l'utilisateur (2026-09-27) : conserver les unités mineures. Les API continuent d'exposer des chaînes décimales en unités majeures.

## A-44 — Documents sources absents

`API Gateway_ARCHITECTURE.docx` et `UI-UX.docx` ne sont pas disponibles. Les responsabilités des gateways sont reprises du prompt d'extraction (§4) ; `TontineMoney_Charte.pdf` est une charte graphique sans impact sur le backend. Les user stories (`docs/specs/`) restent la source de vérité.

## A-45 — Extraction progressive

Décision de l'utilisateur (2026-09-27) : extraire les microservices étape par étape à partir du monolithe modulaire existant (docs/extraction-plan.md) plutôt que de tout réécrire. Tant qu'un domaine n'est pas extrait, il reste un module de `apps/api`, routé par l'API Gateway comme un service.

## A-46 — Broker Kafka en local

Les étapes qui font communiquer plusieurs processus par Kafka exigent Docker Desktop (Redpanda). Sans Docker, le développement local utilise `EVENT_TRANSPORT=inprocess` dans un seul processus et les gateways routent vers `apps/api`.

## A-47 — Payment Gateway et appels internes

Les webhooks des PSP sont reçus uniquement par le Payment Gateway (`apps/payment-gateway`, `POST /api/v1/webhooks/payments/:provider`) : prestataire activé, taille (64 Ko), signature et horodatage (tolérance 300 s), normalisation (montant entier en unités mineures, devise ISO 4217 prise en charge, statut SUCCESS | FAILED), non-rejeu et idempotence par (prestataire, identifiant d'événement) dans son journal `pgw_webhook_receipts`. Un même identifiant avec un contenu différent est refusé (409). Une seule requête transmet un événement à la fois (bail `claimedAt`, repris s'il expire après un arrêt). La transmission au Payment Service est un **appel interne signé** (HMAC-SHA256 de l'appelant, de l'horodatage et du corps, tolérance 60 s, secret `INTERNAL_SERVICE_SECRET`) sur `/api/v1/internal/payments/notifications`, bloqué par l'API Gateway. Le Payment Service reste seul juge du paiement (existence, référence PSP, montant, devise, statut) et reste idempotent. Réponses au PSP : 200 (traité ou doublon), 400/401/404/409 (définitif), 503 (à réessayer). Flutterwave et Paystack : vérificateurs prêts mais désactivés, interdits en production dans cette version ; leurs montants en unités majeures sont convertis exactement selon l'exposant de la devise (l'ancien adaptateur multipliait un flottant par 100, corrigé). En attendant Kafka (A-46), la transmission est synchrone ; elle deviendra un événement à l'étape 3.

## A-48 — Schémas PostgreSQL par service

Chaque service a son schéma (`auth`, `members`, `kyc`, `compliance`, `tontines`, `wallets`, `transactions`, `payments`, `notifications`, `administration`, `payment_gateway`) ; les tables techniques partagées (outbox, inbox, idempotence, audit, jobs) sont dans `platform` jusqu'à la séparation des processus. Migration écrite à la main (`ALTER … SET SCHEMA`) pour conserver les données ; les noms de tables gardent leur préfixe. Les connexions applicatives fixent `search_path` (requêtes SQL brutes aux noms non qualifiés) ; la base porte le même réglage par défaut. `KycLevel` n'est plus partagé : la demande KYC utilise son propre type `KycTargetLevel` (mêmes valeurs). Les rôles `tm_<schéma>` sont `NOLOGIN` : les comptes de connexion des services extraits en deviendront membres (étape 7) ; le script exige `CREATEROLE` (accordé au rôle `tontine` en local, superutilisateur en Docker / CI). Les accès inter-schémas restants sont tous en lecture et listés avec leur échéance (docs/data-ownership.md §2).

## A-49 — Rôle COMPLIANCE_AGENT et séparation des fonctions

Rôle ajouté par le prompt d'extraction. Les spécifications ne répartissent pas les tâches entre agent KYC et agent conformité ; option la plus sûre retenue : **séparation des fonctions**. L'agent KYC vérifie les identités (file de revue, documents, doublons) et tranche les correspondances AML qui bloquent un dossier ; il ne traite plus les dossiers de conformité ni le score de risque. L'agent conformité traite les dossiers de conformité, le score de risque, la validation de conformité et les correspondances AML ; il n'a accès ni à la file de revue KYC ni aux documents d'identité. Screening AML à la demande et lecture de l'annuaire des membres : les deux. Assignation d'un dossier : uniquement à un compte actif COMPLIANCE_AGENT ou SUPER_ADMIN ; un agent ne peut que s'attribuer ou libérer un dossier ; seul l'agent assigné (ou le super-admin) peut le clore. Compte de démonstration : `agent.conformite@tontinemoney.local`.

## A-50 — Service d'administration : paramètres, suspension de compte, tableau de bord

**Paramètres modifiables à chaud** (`/admin/configurations`, super-admin) : seules des règles de politique issues des spécifications, chacune lue à un seul endroit par le port `CONFIGURATION` — SMS non urgents par jour (`notifications.sms.dailyLimit`, 10, R-COM-03), violations avant suspension (`compliance.violations.suspendAfter`, 5, US-9.4), sessions simultanées (`auth.sessions.max`, 5, US-1.4), validité d'une invitation (`tontines.invitations.ttlDays`, 7 jours, US-4.2). Valeur bornée par sa définition (`packages/contracts`), motif obligatoire, verrou optimiste par version, historique en ajout seul, audit, événement `admin.configuration.updated` (invalidation des caches, TTL 30 s). Valeur absente ou invalide : défaut de la définition (un paramètre ne fait jamais échouer un traitement). Les seuils de sécurité (tentatives OTP, verrouillages, durées de jetons) restent volontairement figés dans le code.

**Suspension de compte** (`PATCH /admin/users/:id/status`) : ACTIVE ⇄ SUSPENDED uniquement, motif obligatoire ; la suspension révoque toutes les sessions et le jeton en cours est refusé dès la requête suivante (statut vérifié à chaque appel). Interdit sur son propre compte et sur le dernier super-admin actif. Distincte de la suspension du profil membre (`/members/:id/status`), qui porte sur les opérations financières.

**Tableau de bord** (`GET /admin/dashboard`) : comptes par statut et demandes d'accès en attente (port `AccountDirectoryPort`, sans lecture des tables d'Auth), files KYC, dossiers de conformité ouverts et non assignés, paiements en cours, transactions du jour, événements morts, tâches en échec, dernière réconciliation.

## A-51 — Notification et communication

**Notification** (`services/notifications`, schéma `notifications`) décide **quoi, à qui et quand** : modèles, préférences, heures calmes, canal, file d'attente priorisée, politique de réessai (3 tentatives, backoff 30 s / 2 min / 10 min), DLQ et repli de canal (SMS ⇄ email), boîte de réception in-app. **Communication** (`services/communication`, schéma `communication`) décide **comment** : adresse du destinataire (port Membres), fournisseur du canal (SMS simulé, SMTP, push simulé), limite anti-spam SMS par destinataire (R-COM-03, paramètre `notifications.sms.dailyLimit`), journal de livraison `ntf_outbound_messages` (avec destinataire et priorité), console des messages simulés. Une tentative par appel du port `COMMUNICATION` (`send` : destinataire membre ; `deliver` : adresse explicite pour les secrets — activation, OTP, réinitialisation — sans limite anti-spam). Appel synchrone en processus unique ; il deviendra la paire d'événements `communication.requested` / `communication.result` avec Kafka (étape 3), sans changer les responsabilités. Le journal de livraison utilise son propre type `DeliveryChannel` (aucun type partagé entre schémas).

## A-52 — Fiabilité du transport d'événements (étape 3)

Topics versionnés `<type>.v<version>` : une version incompatible d'un événement devient un nouveau topic, consommé en parallèle le temps de la migration des consommateurs. `tenantId` ajouté à l'enveloppe mais toujours `null` (aucun multi-opérateur prévu par les spécifications) ; les messages sans ce champ restent acceptés. Côté consommateur, un message invalide (JSON, type, version, schéma, topic) n'est **jamais** réessayé ; un consommateur en échec est réessayé `EVENT_CONSUMER_MAX_ATTEMPTS` fois (3 par défaut, attente 200 ms / 1 s / 5 s) puis le message est rejeté. Un rejet est consigné (`platform.event_dead_letters`, message d'origine conservé 256 Ko) et publié sur `tontinemoney.dead-letter.v1`, puis acquitté ; seule une panne du journal des rejets empêche l'acquittement (le message est relu, jamais perdu). Le rejeu revalide le message puis le redistribue : seuls les consommateurs qui n'ont pas encore traité l'événement l'exécutent (inbox). Côté producteur, l'outbox garde ses propres réessais et sa DLQ (`/admin/outbox/dead`). Le transport Kafka réel est testé en CI contre Redpanda (`apps/api/test/kafka.e2e-spec.ts`, ignoré sans broker). Producteur : `acks=-1` (écriture répliquée) et une seule requête en vol (pas de réordonnancement sur réessai) ; l'idempotence côté producteur Kafka est **désactivée par défaut** (`KAFKA_IDEMPOTENT_PRODUCER`) car Redpanda la refuse avec kafkajs (InitProducerId → NOT_COORDINATOR, constaté en CI) — les doublons éventuels d'un réessai réseau sont neutralisés par l'inbox des consommateurs. Consommateur : un **nouveau** groupe lit depuis le début des topics (`fromBeginning`, jamais de perte d'un événement publié avant la première jonction) et le démarrage attend l'attribution des partitions ; un groupe existant reprend à ses offsets validés.
