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
Documents KYC et historique : 7 ans (`retentionUntil` calculé). Tontines clôturées : 5 ans. Un job de purge est fourni en mode *dry-run* uniquement (aucune suppression automatique en V1).

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
