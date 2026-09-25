# TontineMoney — PARTIE 2 : Spécifications Fonctionnelles Détaillées

## Les 12 services principaux

---

# SERVICE 1 — AUTHENTIFICATION & ACCÈS

## 1.1 Objectif

Gérer l'accès sécurisé à la plateforme : inscription, connexion, gestion des sessions, récupération de mot de passe et authentification multi-facteurs.

## 1.2 Acteurs

- **Super-administrateur** : crée les comptes admin de tontine, gère les accès globaux
- **Administrateur de tontine** : inscrit les membres de sa tontine
- **Utilisateur invité** : demande la création d'un compte de manière autonome
- **Membre inscrit** : se connecte, gère ses identifiants

## 1.3 Flux fonctionnels détaillés

### Flux 1 — Inscription par administrateur (mode principal)

1. L'admin de tontine accède au formulaire d'inscription membre
2. Il saisit les informations requises : nom, prénom, email ou téléphone
3. Le système valide l'unicité de l'email/téléphone
4. Le système crée un compte en statut `PENDING_ACTIVATION`
5. Le système génère un code OTP (6 chiffres, validité 15 minutes) ou un lien d'activation unique (validité 48h)
6. Le système envoie le code/lien via le canal choisi (SMS ou email) → événement `notification.send.requested`
7. Le membre reçoit le code/lien et accède à la page de finalisation
8. Le membre définit son mot de passe, accepte les CGU
9. Le système active le compte → statut `ACTIVE_PENDING_KYC`
10. Événement `user.registered` émis → le service Membres crée le profil

**Cas d'erreur** :
- Email/téléphone déjà existant → message d'erreur, suggestion de connexion
- OTP expiré → possibilité de renvoi (max 3 renvois par heure)
- Lien expiré → l'admin doit relancer l'invitation

### Flux 2 — Inscription invité (mode autonome)

1. L'utilisateur accède à la page publique d'inscription
2. Il saisit : nom, prénom, email, téléphone, canal de communication préféré
3. Le système vérifie l'unicité des identifiants
4. Le système crée un compte en statut `PENDING_APPROVAL`
5. Événement `user.approval.requested` émis
6. L'administrateur reçoit une notification de demande d'inscription
7. L'administrateur examine la demande et valide ou refuse
8. Si validé : le système envoie un lien d'activation au membre → statut `PENDING_ACTIVATION`
9. Le membre finalise son inscription (mot de passe, CGU)
10. Événement `user.registered` émis

**Cas de refus** : Le système notifie l'utilisateur du refus avec un motif optionnel. Le compte est archivé, pas supprimé (traçabilité).

### Flux 3 — Connexion / Déconnexion

1. L'utilisateur saisit son identifiant (email ou téléphone) et son mot de passe
2. Le système vérifie les identifiants (bcrypt hash comparison)
3. Si MFA activé : le système demande le second facteur (TOTP ou SMS)
4. Le système génère un `access_token` JWT (durée 15 min) et un `refresh_token` (durée 7 jours)
5. Le `refresh_token` est stocké en base (hashed) et associé au device
6. Événement `user.login` émis avec métadonnées (IP, device, timestamp)
7. Déconnexion : le `refresh_token` est révoqué, ajouté à la blacklist Redis

**Sécurité anti-brute-force** :
- Après 5 tentatives échouées en 10 minutes → verrouillage temporaire (15 min)
- Après 15 tentatives échouées en 1 heure → verrouillage du compte, notification à l'utilisateur
- Chaque tentative échouée est journalisée (IP, timestamp, identifiant tenté)

### Flux 4 — Réinitialisation de mot de passe

1. L'utilisateur demande la réinitialisation via email ou téléphone
2. Le système génère un token unique (validité 1 heure)
3. Le token est envoyé par le canal choisi
4. L'utilisateur clique sur le lien et définit un nouveau mot de passe
5. Le système invalide toutes les sessions actives de l'utilisateur
6. Événement `user.password.reset` émis

**Contraintes mot de passe** : minimum 8 caractères, au moins 1 majuscule, 1 chiffre, 1 caractère spécial. Le système vérifie que le nouveau mot de passe ne fait pas partie des 5 derniers utilisés.

### Flux 5 — Activation MFA

1. L'utilisateur accède aux paramètres de sécurité
2. Il choisit le mode MFA : application authenticator (TOTP) ou SMS
3. Mode TOTP : le système génère un secret et affiche un QR code. L'utilisateur scanne et saisit le code de vérification pour confirmer
4. Mode SMS : le système envoie un code OTP au numéro enregistré. L'utilisateur saisit le code pour confirmer
5. Le système stocke la préférence MFA et génère des codes de récupération (10 codes à usage unique)
6. Événement `user.mfa.enabled` émis

## 1.4 Machine à états — Compte utilisateur

```
                    ┌──────────────────┐
                    │ PENDING_APPROVAL │ (inscription invité)
                    └────────┬─────────┘
                  approuvé   │   refusé
              ┌──────────────┤─────────────┐
              ▼              │             ▼
   ┌─────────────────────┐   │    ┌────────────┐
   │ PENDING_ACTIVATION  │   │    │  REFUSED   │
   └──────────┬──────────┘   │    └────────────┘
     activé   │              │
              ▼              │
   ┌─────────────────────┐   │
   │ ACTIVE_PENDING_KYC  │◄──┘ (inscription admin)
   └──────────┬──────────┘
     KYC ok   │
              ▼
   ┌─────────────────────┐     fraude / violation
   │       ACTIVE        │──────────────────────┐
   └──────────┬──────────┘                      ▼
     demande  │                       ┌──────────────┐
   suppression│                       │  SUSPENDED   │
              ▼                       └──────┬───────┘
   ┌─────────────────────┐             levée │
   │      INACTIVE       │◄─────────────────┘
   └─────────────────────┘
```

## 1.5 Événements émis

| Événement | Payload | Consommateurs |
|---|---|---|
| `user.registered` | userId, email, phone, country, language, registeredBy | Membres, KYC |
| `user.login` | userId, ip, device, timestamp, mfaUsed | Audit, Fraude |
| `user.logout` | userId, sessionId | Audit |
| `user.password.reset` | userId, timestamp | Audit, Notifications |
| `user.mfa.enabled` | userId, mfaType | Audit, Notifications |
| `user.locked` | userId, reason, attemptCount | Notifications, Fraude |
| `user.approval.requested` | userId, requestedTontineId | Notifications (→ admin) |

## 1.6 Événements consommés

| Événement | Source | Action |
|---|---|---|
| `member.status.changed` | Membres | Met à jour les autorisations d'accès |
| `fraud.user.flagged` | Fraude | Verrouille le compte, force la déconnexion |
| `compliance.user.suspended` | Conformité | Suspend l'accès |

## 1.7 Règles métier

- R-AUTH-01 : Un utilisateur ne peut avoir qu'un seul compte actif par email ET par téléphone
- R-AUTH-02 : Le mot de passe doit être haché avec bcrypt (cost factor ≥ 12)
- R-AUTH-03 : Un `access_token` expiré ne peut pas être utilisé pour rafraîchir ; seul le `refresh_token` le permet
- R-AUTH-04 : La révocation d'un `refresh_token` invalide immédiatement toutes les sessions associées au device
- R-AUTH-05 : Les codes OTP sont à usage unique et expirent après 15 minutes
- R-AUTH-06 : Un compte verrouillé ne peut être déverrouillé que par un admin ou après expiration du délai
- R-AUTH-07 : Toute tentative de connexion (réussie ou échouée) est journalisée pour audit

## 1.8 Exigences non fonctionnelles

- Temps de réponse login : < 300 ms (hors latence MFA SMS)
- Disponibilité : 99,9 %
- Stockage des tokens révoqués : Redis avec TTL = durée de vie du token
- Chiffrement : TLS 1.3, mots de passe bcrypt, tokens signés RS256

---

# SERVICE 2 — GESTION DES MEMBRES

## 2.1 Objectif

Maintenir le registre central des profils utilisateurs. Source de vérité pour l'identité fonctionnelle de chaque membre, consultée par tous les autres services.

## 2.2 Flux fonctionnels détaillés

### Flux 1 — Création automatique du profil

1. Le service reçoit l'événement `user.registered`
2. Il crée un enregistrement `Member` avec :
   - Identifiant unique UUID
   - Informations de base (nom, prénom, email, téléphone)
   - Pays/région déduits du numéro de téléphone ou de l'IP d'inscription
   - Langue par défaut selon le pays
   - Statut initial : `PENDING`
   - Niveau KYC : `NONE`
3. Un portefeuille est demandé via événement `member.created`
4. Le KYC est déclenché automatiquement
5. Les préférences de notification sont initialisées aux valeurs par défaut du pays

### Flux 2 — Complétion et mise à jour du profil

1. Le membre accède à son profil via l'interface
2. Il peut modifier : informations personnelles, préférences de langue, fuseau horaire, canal de notification préféré, photo de profil
3. Chaque modification est validée (format email, format téléphone international, pays existant)
4. La modification est sauvegardée avec versionnement (ancien/nouveau)
5. Événement `member.updated` émis avec les champs modifiés
6. L'historique complet des modifications est conservé dans la table `MemberAuditLog`

### Flux 3 — Gestion par l'administrateur de tontine

1. L'admin accède à la liste des membres de sa tontine
2. Il peut : consulter les profils (données non sensibles), valider une inscription, suspendre un membre (avec motif obligatoire), retirer un membre d'une tontine
3. L'admin ne peut PAS : modifier les informations personnelles du membre, accéder aux documents KYC, voir le solde du wallet
4. Chaque action admin est journalisée avec l'identité de l'admin

### Flux 4 — Vérification d'éligibilité pour rejoindre une tontine

1. Le service Tontines demande la vérification d'éligibilité via API synchrone
2. Le service Membres vérifie :
   - Statut du membre = `ACTIVE`
   - Niveau KYC ≥ `TIER_2`
   - Statut conformité ≠ `SUSPENDED` ou `NON_COMPLIANT`
   - Le membre n'est pas déjà dans cette tontine
   - Le pays du membre est compatible avec la tontine (vérification via service Conformité)
3. Réponse : `{ eligible: true/false, reasons: [...] }`

## 2.3 Machine à états — Membre

```
┌──────────┐
│ PENDING  │ Profil créé, incomplet
└────┬─────┘
     │ profil complété
     ▼
┌──────────────┐
│ KYC_REQUIRED │ En attente de soumission KYC
└────┬─────────┘
     │ documents soumis
     ▼
┌───────────────┐
│ KYC_IN_REVIEW │ Vérification en cours
└────┬──────────┘
     │                          │
     │ kyc.verified             │ kyc.rejected
     ▼                          ▼
┌──────────┐             ┌──────────────┐
│  ACTIVE  │             │ KYC_REJECTED │
└────┬─────┘             └──────┬───────┘
     │                          │ nouveaux documents
     │ fraude / conformité      │ soumis → KYC_IN_REVIEW
     ▼                          
┌───────────┐
│ SUSPENDED │ Aucune opération possible
└───────────┘
     │ levée de suspension
     ▼
   ACTIVE
```

## 2.4 Entité — Modèle de données détaillé

```
Member {
  id                    : UUID (PK)
  first_name            : VARCHAR(100) NOT NULL
  last_name             : VARCHAR(100) NOT NULL
  email                 : VARCHAR(255) UNIQUE
  phone                 : VARCHAR(20) UNIQUE
  country_code          : CHAR(2) NOT NULL        -- ISO 3166-1 alpha-2
  region                : VARCHAR(100)
  city                  : VARCHAR(100)
  address               : TEXT
  date_of_birth         : DATE
  gender                : ENUM(M, F, OTHER, UNDISCLOSED)
  language              : VARCHAR(5) NOT NULL      -- BCP 47 : fr-CM, en-US
  timezone              : VARCHAR(50) NOT NULL     -- IANA : Africa/Douala
  status                : ENUM(PENDING, KYC_REQUIRED, KYC_IN_REVIEW, 
                               KYC_REJECTED, ACTIVE, SUSPENDED)
  kyc_level             : ENUM(NONE, TIER_1, TIER_2, TIER_3)
  compliance_status     : ENUM(COMPLIANT, RESTRICTED, UNDER_REVIEW, 
                               NON_COMPLIANT, SUSPENDED)
  profile_photo_url     : TEXT
  notification_prefs    : JSONB
    {
      "preferred_channel": "sms",          -- sms | email | push | in_app
      "frequency": "immediate",             -- immediate | daily_digest
      "enabled_types": ["payment", "tontine", "kyc", "security"],
      "quiet_hours": { "start": "22:00", "end": "07:00" }
    }
  metadata              : JSONB            -- données extensibles
  created_at            : TIMESTAMPTZ NOT NULL
  updated_at            : TIMESTAMPTZ NOT NULL
  version               : INTEGER NOT NULL DEFAULT 1  -- optimistic locking
}

MemberAuditLog {
  id                    : UUID (PK)
  member_id             : UUID (FK → Member)
  action                : ENUM(CREATED, UPDATED, STATUS_CHANGED, 
                               KYC_LEVEL_CHANGED, SUSPENDED, REACTIVATED)
  changed_by            : UUID                     -- userId ayant effectué l'action
  changed_by_role       : ENUM(SYSTEM, MEMBER, ADMIN, SUPER_ADMIN)
  old_values            : JSONB
  new_values            : JSONB
  ip_address            : INET
  device_info           : VARCHAR(255)
  created_at            : TIMESTAMPTZ NOT NULL
}
```

## 2.5 Événements émis

| Événement | Déclencheur | Payload |
|---|---|---|
| `member.created` | Réception de `user.registered` | memberId, country, language, status |
| `member.updated` | Modification du profil | memberId, changedFields[], oldValues, newValues |
| `member.status.changed` | Transition de statut | memberId, oldStatus, newStatus, reason, changedBy |
| `member.kyc.required` | Profil complété sans KYC | memberId |
| `member.suspended` | Suspension par admin/système | memberId, reason, suspendedBy |

## 2.6 Événements consommés

| Événement | Source | Action déclenchée |
|---|---|---|
| `user.registered` | Auth | Création du profil membre |
| `kyc.verified` | KYC | Status → ACTIVE, kycLevel → TIER_X |
| `kyc.rejected` | KYC | Status → KYC_REJECTED |
| `kyc.review.required` | KYC | Status → KYC_IN_REVIEW |
| `fraud.user.flagged` | Fraude | Status → SUSPENDED, reason = fraud |
| `compliance.user.restricted` | Conformité | complianceStatus → RESTRICTED |
| `compliance.user.suspended` | Conformité | Status → SUSPENDED |
| `compliance.rule.updated` | Conformité | Réévaluation conformité du membre |

## 2.7 Règles métier

- R-MBR-01 : Un membre doit être KYC TIER_2 minimum pour participer à une tontine
- R-MBR-02 : Un membre SUSPENDED ne peut effectuer aucune opération (transaction, paiement, tontine)
- R-MBR-03 : Les informations personnelles doivent être complètes avant toute opération financière (nom, prénom, pays, téléphone ou email)
- R-MBR-04 : Un membre ne peut pas se désinscrire lui-même d'une tontine
- R-MBR-05 : Les préférences de langue doivent être respectées dans toutes les communications
- R-MBR-06 : Toute modification de profil est versionnée et auditable
- R-MBR-07 : Un membre ne peut voir que ses propres activités et données financières

---

# SERVICE 3 — KYC (Know Your Customer)

## 3.1 Objectif

Vérifier l'identité des utilisateurs, évaluer le risque, et garantir la conformité réglementaire avant toute opération financière.

## 3.2 Niveaux KYC détaillés

| Niveau | Données requises | Vérifications | Droits accordés |
|---|---|---|---|
| **TIER_1** | Nom, prénom, date de naissance, email, téléphone | Validation format, unicité, OTP email/SMS | Consultation uniquement, complétion de profil |
| **TIER_2** | Pièce d'identité (recto/verso) + selfie | OCR document, face match selfie ↔ document, vérification expiration, détection falsification, screening AML | Participation tontines, contributions/retraits ≤ plafond pays (ex: 500 000 XAF/mois) |
| **TIER_3** | Justificatif de domicile + vérification vidéo live + déclaration de source de revenus | Vérification adresse, liveness detection, contrôle renforcé AML (PEP, sanctions), vérification source de fonds | Paiements illimités, création de tontines, rôle admin tontine |

## 3.3 Flux fonctionnels détaillés

### Flux 1 — Soumission et vérification automatique (TIER_2)

1. Le membre accède à la page KYC depuis son profil
2. Le système affiche les documents requis selon le pays du membre
3. Le membre upload sa pièce d'identité (recto/verso) :
   - Formats acceptés : JPEG, PNG, PDF (max 10 Mo par fichier)
   - Résolution minimale : 300 DPI ou 1000×600 pixels
4. Le membre prend un selfie en temps réel (pas d'upload d'image existante) :
   - Liveness check : demande de tourner la tête ou de cligner des yeux
5. Le système stocke les fichiers de manière chiffrée (AES-256) dans S3
6. Le statut KYC passe à `SUBMITTED`
7. Événement `kyc.submitted` émis
8. **Vérification automatique** (pipeline asynchrone, < 5 secondes) :
   - **Étape 1 — OCR** : extraction des champs (nom, date de naissance, numéro du document, date d'expiration, nationalité)
   - **Étape 2 — Validation du document** : format attendu pour le pays, cohérence des champs, document non expiré, détection de manipulation (retouche photo, scan de copie)
   - **Étape 3 — Face match** : comparaison biométrique selfie ↔ photo du document. Score de confiance ≥ 85% requis
   - **Étape 4 — Détection de doublons** : recherche en base d'un visage similaire déjà enregistré. Score de similarité > 90% = alerte doublon
   - **Étape 5 — Screening AML** : vérification du nom + date de naissance contre les listes de sanctions (OFAC, ONU, UE, Interpol) et les listes PEP (Politically Exposed Persons)
9. Si toutes les étapes passent : statut → `VERIFIED`, kycLevel → `TIER_2`
10. Si une étape échoue : statut → `REVIEW_REQUIRED` avec détail des étapes en échec

### Flux 2 — Vérification manuelle (escalade)

1. Un agent KYC accède au tableau de bord des dossiers en `REVIEW_REQUIRED`
2. Le système affiche : les documents soumis, le résultat de chaque étape automatique avec le score, les alertes éventuelles (doublon, AML match, face match faible)
3. L'agent peut :
   - Zoomer sur les documents, les comparer visuellement
   - Consulter l'historique de l'utilisateur
   - Demander des documents complémentaires au membre
   - Accepter le KYC avec annotation justificative
   - Rejeter le KYC avec motif obligatoire et catégorie de rejet
4. Si accepté : statut → `VERIFIED`, événement `kyc.verified` émis
5. Si rejeté : statut → `REJECTED`, événement `kyc.rejected` émis avec le motif

**Catégories de rejet** : DOCUMENT_ILLISIBLE, DOCUMENT_EXPIRE, DOCUMENT_FALSIFIE, FACE_MATCH_ECHOUE, DOUBLON_DETECTE, AML_MATCH, INFORMATION_INCOHERENTE, AUTRE

### Flux 3 — Cycle de vie KYC (renouvellement)

1. Le système exécute un job quotidien pour détecter les documents arrivant à expiration dans les 30 prochains jours
2. 30 jours avant expiration : notification d'avertissement au membre
3. 7 jours avant : rappel urgent
4. À l'expiration : statut KYC → `EXPIRED`, kycLevel baisse d'un tier
5. Le membre doit resoumettre les documents
6. Si aucune action après 30 jours post-expiration : suspension des opérations financières
7. Re-vérification périodique obligatoire pour les profils à risque élevé (tous les 6 mois)

## 3.4 Machine à états — KYC

```
┌────────┐
│  NONE  │ Aucun KYC initié
└───┬────┘
    │ soumission documents
    ▼
┌─────────────┐
│  SUBMITTED  │ Documents reçus, en attente de traitement
└───┬─────────┘
    │ traitement auto lancé
    ▼
┌──────────────┐
│  PROCESSING  │ Vérification automatique en cours
└───┬──────────┘
    │                    │                    │
    │ tout OK            │ échec partiel      │ échec critique
    ▼                    ▼                    ▼
┌──────────┐    ┌─────────────────┐    ┌──────────┐
│ VERIFIED │    │ REVIEW_REQUIRED │    │ REJECTED │
└────┬─────┘    └────────┬────────┘    └────┬─────┘
     │                   │                   │
     │ expiration doc    │ agent valide/     │ nouveaux docs
     ▼                   │ rejette           │ soumis
┌──────────┐             ▼                   │
│ EXPIRED  │       VERIFIED ou REJECTED      │
└────┬─────┘                                 │
     │ resoumet                              │
     └──────────────────►SUBMITTED◄──────────┘
```

## 3.5 Intégration avec providers KYC externes

| Provider | Région cible | Fonctions |
|---|---|---|
| **Smile Identity** | Afrique subsaharienne | OCR documents africains, face match, liveness, AML screening |
| **Onfido** | Global | OCR, face match, document authentication, liveness video |
| **Jumio** | Global | ID verification, selfie, AML/PEP screening |

**Pattern d'intégration** : Adaptateur par provider derrière une interface commune `KycVerificationProvider`. Le service orchestre les appels via un circuit breaker avec fallback vers un provider alternatif en cas d'indisponibilité.

## 3.6 Événements émis

| Événement | Payload | Consommateurs |
|---|---|---|
| `kyc.submitted` | memberId, kycLevel, documentTypes[] | Membres, Notifications |
| `kyc.verified` | memberId, kycLevel, verifiedAt, verifiedBy (auto/agent) | Membres, Tontines, Conformité, Wallet |
| `kyc.rejected` | memberId, rejectReason, rejectCategory, rejectedBy | Membres, Notifications |
| `kyc.review.required` | memberId, failedSteps[], scores | Notifications (→ agents) |
| `kyc.expired` | memberId, expiredDocumentType, expirationDate | Membres, Notifications, Tontines |
| `kyc.duplicate.detected` | memberId, duplicateOfMemberId, similarityScore | Fraude, Membres |

## 3.7 Événements consommés

| Événement | Source | Action |
|---|---|---|
| `member.created` | Membres | Initialise le dossier KYC pour le nouveau membre |
| `fraud.user.flagged` | Fraude | Force une re-vérification KYC immédiate |
| `compliance.rule.updated` | Conformité | Met à jour les exigences KYC du pays |

## 3.8 Règles métier

- R-KYC-01 : Un utilisateur non vérifié (NONE ou REJECTED) ne peut pas créer de tontine, recevoir de fonds, ni effectuer de paiements
- R-KYC-02 : Le face match doit atteindre un score ≥ 85% pour validation automatique. Entre 70% et 85% → escalade manuelle. < 70% → rejet automatique
- R-KYC-03 : Un document expiré au moment de la soumission est automatiquement rejeté
- R-KYC-04 : La détection d'un doublon (similarité > 90%) bloque automatiquement le nouveau compte et déclenche une alerte fraude
- R-KYC-05 : Les documents KYC sont stockés chiffrés (AES-256) et ne sont accessibles qu'aux agents KYC autorisés et au système de vérification
- R-KYC-06 : L'historique complet des vérifications est conservé 7 ans minimum (exigence réglementaire)
- R-KYC-07 : Un utilisateur rejeté peut resoumettre de nouveaux documents sans limite de tentatives, mais chaque resoumission déclenche une vérification complète
- R-KYC-08 : Le screening AML est exécuté à chaque soumission KYC et périodiquement (batch quotidien) pour les membres actifs

---

# SERVICE 4 — GESTION DES TONTINES

## 4.1 Objectif

Piloter l'intégralité du cycle de vie d'une tontine : création, configuration, gestion des membres, orchestration des cycles (tours), détermination des bénéficiaires, déclenchement des paiements et clôture.

## 4.2 Types de tontines supportés (par itération)

| Type | Itération | Description |
|---|---|---|
| Simple rotative | V1 | Contributions fixes, bénéficiaire par tour (tirage ou ordre), pas de caisse annexe |
| Financière avec caisse de prêts | V2 | Ajout d'un compte de prêts alimenté par les intérêts |
| Financière avec caisse de prêts et secours | V2 | Ajout d'un compte solidarité pour les urgences |
| Financière avec enchères non capitalisées | V3 | Les membres enchérissent pour recevoir le pot, la prime n'est pas réinvestie |
| Financière avec enchères capitalisées | V3 | Les primes d'enchère sont réinvesties dans le pot |
| Immobilière | V4 | Contributions vers un projet immobilier collectif |

## 4.3 Flux fonctionnels détaillés — Tontine simple rotative

### Flux 1 — Création et configuration

1. Un membre ACTIVE avec KYC ≥ TIER_3 accède au formulaire de création
2. Il configure les paramètres suivants :

| Paramètre | Type | Contraintes |
|---|---|---|
| Nom de la tontine | Texte | 3-200 caractères, unique par créateur |
| Montant de contribution | Décimal | > 0, devise imposée par le pays |
| Devise | Code ISO | Devise du pays du créateur |
| Fréquence | Enum | WEEKLY, BIWEEKLY, MONTHLY, BIMONTHLY |
| Détail fréquence | JSON | Ex: `{"day":"wednesday","week_of_month":1}` pour "1er mercredi du mois" |
| Nombre max de membres | Entier | 3 à 50 |
| Date de début | Date | ≥ aujourd'hui + 7 jours (délai pour recruter) |
| Mode de tirage | Enum | RANDOM (aléatoire), FIXED_ORDER (prédéfini), PRIORITY_NEED |
| Pénalité retard | JSON | `{"grace_days":3,"late_fee_percent":5,"suspend_after":2}` |
| Droit d'entrée | Décimal | ≥ 0 (frais unique à l'adhésion) |
| Collation | Décimal | ≥ 0 (frais pour la réception physique) |

3. Le système valide les paramètres et crée la tontine en statut `DRAFT`
4. Le créateur est automatiquement inscrit comme admin de la tontine
5. Événement `tontine.created` émis

### Flux 2 — Invitation et inscription des membres

1. L'admin de la tontine invite des membres par email, téléphone ou lien partageable
2. Le membre invité reçoit une notification avec les détails de la tontine
3. Le membre accepte ou refuse l'invitation
4. Si accepté, le système vérifie l'éligibilité (API synchrone → service Membres) :
   - Statut ACTIVE
   - KYC ≥ TIER_2
   - Conformité OK
   - Pays compatible
5. Si éligible : inscription confirmée, paiement du droit d'entrée si applicable
6. Si non éligible : notification avec les raisons du refus
7. Lorsque le nombre minimum de membres est atteint, la tontine passe en statut `READY`

### Flux 3 — Démarrage de la tontine

1. À la date de début, le système vérifie les conditions de démarrage :
   - Nombre de membres ≥ 3
   - Tous les membres sont KYC vérifiés
   - Tous les droits d'entrée ont été payés
   - Tous les statuts sont ACTIVE
2. Si toutes les conditions sont remplies :
   - Statut tontine → `ACTIVE`
   - Le premier cycle est créé en statut `IN_PROGRESS`
   - Si mode RANDOM : tirage de l'ordre complet pour tous les cycles (ou tirage cycle par cycle selon la config)
   - Si mode FIXED_ORDER : l'admin a déjà défini l'ordre
   - Le bénéficiaire du cycle 1 est déterminé
   - Événement `tontine.started` émis
   - Les échéances de contribution sont générées pour chaque membre
   - Les notifications sont envoyées à tous les membres
3. Si conditions non remplies : statut reste `READY`, notification à l'admin avec les blocages

### Flux 4 — Déroulement d'un cycle (tour)

```
JOUR J : Début du cycle N
├── Génération des échéances de contribution pour chaque membre
├── Notification "Contribution due" envoyée à chaque membre
│
JOUR J → J+X : Période de collecte
├── Les membres paient leur contribution (via wallet ou paiement externe)
├── Chaque paiement reçu : mise à jour du suivi, notification de confirmation
├── Suivi temps réel : X/N membres ont payé
│
JOUR J+GRACE : Fin de la période de grâce
├── Détection des retards
├── Pour chaque membre en retard :
│   ├── Notification de rappel urgent
│   ├── Application de la pénalité (% du montant de contribution)
│   └── Si retards cumulés ≥ seuil : suspension du membre
│
JOUR J+DEADLINE : Date limite de contribution
├── Vérification : toutes les contributions sont-elles reçues ?
│   ├── OUI → Déclenchement du paiement au bénéficiaire
│   └── NON → Selon la config :
│       ├── Option A : paiement partiel (montant collecté uniquement)
│       ├── Option B : report du cycle (nouvelle date limite)
│       └── Option C : avance par la caisse de réserve (si applicable)
│
PAIEMENT AU BÉNÉFICIAIRE
├── Le total collecté est transféré au wallet du bénéficiaire
├── Transaction enregistrée avec détail de chaque contribution
├── Notification au bénéficiaire + notification à tous les membres
├── Événement tontine.cycle.completed émis
│
PASSAGE AU CYCLE SUIVANT
├── Nouveau cycle créé, nouveau bénéficiaire déterminé
├── Si tous les cycles sont complétés → clôture de la tontine
```

### Flux 5 — Gestion des nouveaux membres en cours de cycle

1. Un nouveau membre peut rejoindre une tontine active si l'admin l'autorise
2. Le nouveau membre doit rattraper les contributions passées :
   - Il verse sa contribution à chaque membre ayant déjà été bénéficiaire
   - Ces versements de rattrapage sont traités comme des transactions individuelles
3. Le nouveau membre est ajouté à la fin de l'ordre de passage
4. Le nombre total de cycles augmente en conséquence

### Flux 6 — Clôture de la tontine

1. Lorsque le dernier cycle est complété (tous les membres ont été bénéficiaires une fois)
2. Le système vérifie qu'il n'y a pas de paiements en attente ou de pénalités impayées
3. Statut tontine → `COMPLETED`
4. Un rapport final est généré automatiquement (contributions, bénéficiaires, pénalités, historique)
5. Événement `tontine.closed` émis
6. Les données sont archivées mais restent consultables

## 4.4 Machine à états — Tontine

```
┌─────────┐
│  DRAFT  │ Configuration en cours, membres invités
└────┬────┘
     │ conditions min remplies
     ▼
┌─────────┐
│  READY  │ Prête à démarrer, en attente de la date de début
└────┬────┘
     │ date de début + conditions OK
     ▼
┌──────────┐     anomalie / fraude     ┌───────────┐
│  ACTIVE  │ ─────────────────────────►│  PAUSED   │
└────┬─────┘                           └─────┬─────┘
     │                                       │ résolution
     │ tous les cycles complétés             │
     ▼                                       ▼
┌────────────┐                             ACTIVE
│ COMPLETED  │
└────────────┘

     Depuis DRAFT ou READY :
┌────────────┐
│ CANCELLED  │ Annulée par l'admin avant démarrage
└────────────┘
```

## 4.5 Machine à états — Cycle (Tour)

```
┌───────────┐
│  PENDING  │ Cycle programmé, pas encore démarré
└─────┬─────┘
      │ date de début atteinte
      ▼
┌──────────────┐
│ IN_PROGRESS  │ Collecte des contributions en cours
└─────┬────────┘
      │ toutes contributions reçues
      ▼
┌────────────────┐
│ PAYOUT_PENDING │ En attente de paiement au bénéficiaire
└─────┬──────────┘
      │ paiement effectué
      ▼
┌────────────┐
│ COMPLETED  │ Cycle terminé
└────────────┘
```

## 4.6 Machine à états — Contribution (par membre par cycle)

```
┌───────────┐
│  PENDING  │ Échéance créée, en attente de paiement
└─────┬─────┘
      │                    │
      │ paiement reçu      │ deadline dépassée + grâce
      ▼                    ▼
┌────────┐           ┌────────┐
│  PAID  │           │  LATE  │ Pénalité appliquée
└────────┘           └───┬────┘
                         │                    │
                         │ paiement reçu      │ toujours impayée
                         ▼                    ▼
                    ┌────────────┐     ┌────────────┐
                    │ PAID_LATE  │     │ DEFAULTED  │
                    └────────────┘     └────────────┘
```

## 4.7 Algorithme de tirage

**Mode RANDOM** :
- Algorithme Fisher-Yates shuffle avec un seed cryptographiquement sûr (`crypto.randomBytes`)
- Le tirage est effectué une seule fois au démarrage de la tontine (option A) ou cycle par cycle parmi les non-bénéficiaires (option B)
- Le résultat est enregistré en base et signé (hash SHA-256 du résultat + timestamp) pour prouver l'intégrité a posteriori
- Le tirage est visible par tous les membres

**Mode FIXED_ORDER** :
- L'admin définit manuellement l'ordre de passage
- Les membres voient l'ordre complet dès le démarrage
- L'admin peut modifier l'ordre pour les cycles futurs uniquement (pas le cycle en cours ou les passés)

**Mode PRIORITY_NEED** :
- Les membres soumettent une demande justifiée pour être prioritaires
- L'admin ou un vote des membres détermine le bénéficiaire
- Chaque membre ne peut être bénéficiaire qu'une seule fois

## 4.8 Fréquences supportées — Détail

| Fréquence | Variantes | Calcul de la prochaine date |
|---|---|---|
| **MONTHLY** | 1er mercredi, 2e jeudi, 4e mercredi, dernier jour du mois | `nthWeekdayOfMonth(month, weekday, n)` |
| **BIMONTHLY** | Le 15 et le 30 de chaque mois | Dates fixes dans le mois |
| **BIWEEKLY** | Tous les jeudis, tous les vendredis | `currentDate + 14 jours` aligné sur le jour |
| **WEEKLY** | Jour fixe de la semaine | `currentDate + 7 jours` |

Le système calcule automatiquement le nombre total de cycles en fonction de la fréquence et du nombre de membres. Exemples : tontine de 12 membres mensuelle = 12 cycles = 12 mois ; tontine de 10 membres bimensuelle = 10 cycles = 5 mois.

## 4.9 Événements émis

| Événement | Payload |
|---|---|
| `tontine.created` | tontineId, createdBy, type, params |
| `tontine.started` | tontineId, memberCount, firstBeneficiaryId |
| `tontine.cycle.started` | tontineId, cycleId, cycleNumber, beneficiaryId, dueDate |
| `tontine.contribution.due` | tontineId, cycleId, memberId, amount, dueDate |
| `tontine.contribution.received` | tontineId, cycleId, memberId, amount, transactionId |
| `tontine.contribution.late` | tontineId, cycleId, memberId, penaltyAmount |
| `tontine.contribution.defaulted` | tontineId, cycleId, memberId |
| `tontine.payout.initiated` | tontineId, cycleId, beneficiaryId, totalAmount |
| `tontine.cycle.completed` | tontineId, cycleId, cycleNumber, beneficiaryId, totalAmount |
| `tontine.member.added` | tontineId, memberId, position |
| `tontine.member.removed` | tontineId, memberId, reason |
| `tontine.closed` | tontineId, totalCycles, totalAmount |
| `tontine.paused` | tontineId, reason |

## 4.10 Événements consommés

| Événement | Source | Action |
|---|---|---|
| `payment.completed` | Paiements | Marque la contribution comme payée |
| `payment.failed` | Paiements | Relance ou escalade |
| `member.status.changed` | Membres | Réévalue l'éligibilité du membre |
| `member.suspended` | Membres | Suspend la participation du membre |
| `kyc.verified` | KYC | Autorise la participation si en attente KYC |
| `wallet.balance.updated` | Wallet | Vérifie la capacité de contribution |
| `compliance.rule.updated` | Conformité | Réévalue les règles de la tontine |

## 4.11 Règles métier

- R-TON-01 : Une tontine ne peut démarrer que si tous les membres sont KYC ≥ TIER_2
- R-TON-02 : Le créateur d'une tontine doit être KYC TIER_3
- R-TON-03 : Un bénéficiaire ne peut être sélectionné qu'une seule fois par cycle complet
- R-TON-04 : Une contribution manquante au-delà de la période de grâce déclenche une pénalité automatique
- R-TON-05 : Après N défauts consécutifs (configurable), le membre est suspendu de la tontine
- R-TON-06 : Le paiement au bénéficiaire n'est déclenché que lorsque toutes les contributions sont reçues (sauf si mode paiement partiel activé)
- R-TON-07 : Une tontine active peut être mise en pause uniquement par le super-admin en cas de fraude
- R-TON-08 : L'ordre de tirage ne peut pas être modifié pour les cycles passés ou en cours
- R-TON-09 : Le nombre de membres ne peut pas dépasser 50 (contrainte de gestion)
- R-TON-10 : Les données d'une tontine clôturée sont conservées 5 ans minimum

---

# SERVICE 5 — PORTEFEUILLE ÉLECTRONIQUE (WALLET)

## 5.1 Objectif

Gérer les soldes internes, les mouvements d'argent, les blocages de fonds et l'historique pour chaque membre. Le wallet est le compte virtuel central de la plateforme.

## 5.2 Flux fonctionnels détaillés

### Flux 1 — Création automatique

1. Réception de l'événement `member.created`
2. Création du wallet avec : solde = 0, blockedAmount = 0, devise = devise du pays du membre, statut = `ACTIVE`
3. Événement `wallet.created` émis

### Flux 2 — Crédit (dépôt)

1. Le service Paiements confirme un paiement externe réussi (`payment.completed`)
2. Le service Wallet vérifie : wallet actif, devise correspondante
3. Opération ACID : `balance += amount`, création du mouvement de type `CREDIT`
4. Événement `wallet.balance.updated` émis
5. Notification envoyée au membre

### Flux 3 — Débit (contribution tontine)

1. Le service Tontines demande le prélèvement d'une contribution
2. Le service Wallet vérifie :
   - Wallet actif (pas SUSPENDED ni LOCKED)
   - Solde disponible suffisant : `balance - blocked_amount ≥ amount`
   - Pas de blocage fraude actif
3. Si OK : opération ACID avec isolation `SERIALIZABLE` :
   - `balance -= amount`
   - Création du mouvement de type `DEBIT`, contexte `TONTINE_CONTRIBUTION`
4. Si solde insuffisant : rejet avec code `INSUFFICIENT_FUNDS`
5. Événement `wallet.balance.updated` émis

### Flux 4 — Blocage / Déblocage de fonds (hold)

1. Un service demande le blocage d'un montant (ex : contribution en attente de confirmation PSP)
2. Vérification : `balance - blocked_amount ≥ holdAmount`
3. Si OK : `blocked_amount += holdAmount`, création d'un enregistrement `WalletHold`
4. Événement `wallet.hold.created` émis
5. À la confirmation : le hold est converti en débit réel → `blocked_amount -= holdAmount`, `balance -= holdAmount`
6. En cas d'échec : le hold est annulé → `blocked_amount -= holdAmount`
7. Événement `wallet.hold.released` émis

### Flux 5 — Transfert interne (membre → membre)

1. Le membre A initie un transfert vers le membre B
2. Le système vérifie les deux wallets (actifs, devise compatible)
3. Transaction atomique :
   - Débit wallet A
   - Crédit wallet B
   - Deux mouvements créés (DEBIT + CREDIT)
   - Clé d'idempotence pour éviter les doublons
4. En cas d'échec partiel : rollback complet

## 5.3 Machine à états — Wallet

```
┌──────────┐
│  ACTIVE  │ Opérations normales
└────┬─────┘
     │ fraude détectée          │ enquête
     ▼                          ▼
┌───────────┐            ┌──────────┐
│ SUSPENDED │            │  LOCKED  │
└─────┬─────┘            └────┬─────┘
      │ levée                  │ fin enquête
      ▼                        ▼
    ACTIVE                   ACTIVE ou CLOSED

┌──────────┐
│  CLOSED  │ Terminal — solde doit être à 0
└──────────┘
```

## 5.4 Événements émis

| Événement | Payload |
|---|---|
| `wallet.created` | walletId, memberId, currency |
| `wallet.balance.updated` | walletId, memberId, oldBalance, newBalance, movementType, amount |
| `wallet.hold.created` | walletId, holdId, amount, context |
| `wallet.hold.released` | walletId, holdId, amount, released/converted |
| `wallet.debit.failed` | walletId, memberId, reason, requestedAmount |
| `wallet.status.changed` | walletId, oldStatus, newStatus, reason |

## 5.5 Règles métier

- R-WAL-01 : Le solde ne peut jamais devenir négatif (`balance ≥ 0` toujours)
- R-WAL-02 : Le solde disponible = `balance - blocked_amount` ; seul ce montant est utilisable
- R-WAL-03 : Un wallet SUSPENDED ne peut subir que des crédits (remboursements), pas de débits
- R-WAL-04 : Un wallet LOCKED ne peut subir aucune opération
- R-WAL-05 : Chaque mouvement est immuable et journalisé avec context, transaction_id, timestamp
- R-WAL-06 : Les opérations de débit utilisent un lock optimiste (version) ou un lock `SERIALIZABLE` pour éviter les race conditions
- R-WAL-07 : Un wallet ne peut être fermé que si le solde est à 0 et qu'aucun hold n'est actif




Voici la synthèse des décisions à prendre pour chaque lacune :
TTL des holds — c'est la lacune la plus mécanique à corriger. Il faut ajouter expires_at sur WalletHold, définir des TTL par contexte (15 min tontine, 1 h transfert, 24 h défaut), et implémenter un job planifié qui s'exécute toutes les minutes avec SELECT FOR UPDATE SKIP LOCKED pour être safe en multi-instance. L'événement wallet.hold.expired est indispensable pour que les services consommateurs (Tontines, Paiements) puissent réagir.
Conversion de devise — c'est une décision d'architecture avant d'être une décision technique. La recommandation est de choisir explicitement le rejet strict (CURRENCY_MISMATCH) pour la v1 et de le documenter — c'est traçable, testable, et évite un scope rampant. La conversion FX est une feature v2 avec ses propres exigences réglementaires (AML, limites de transfert).
Machine à états — deux corrections chirurgicales : ajouter la flèche SUSPENDED → CLOSED dans le diagramme, et spécifier les deux déclencheurs de LOCKED. La table WalletStatusHistory est importante pour l'audit — toute transition d'état doit être traçable avec triggeredBy (admin ID ou fraud-service).
Isolation SQL — pas besoin de tout mettre en SERIALIZABLE. Le crédit n'en a pas besoin si l'idempotence est gérée via payment_id. REPEATABLE READ suffit pour les holds. SERIALIZABLE reste nécessaire pour les débits et transferts. L'ordre de lock déterministe sur les transferts (wallet avec le plus petit ID en premier) est la correction la plus simple pour éliminer définitivement le risque de deadlock.

---

# SERVICE 6 — TRANSACTIONS

## 6.1 Objectif

Orchestrer les flux financiers internes. Chaque mouvement d'argent sur la plateforme passe par une transaction qui assure validation, exécution ACID, suivi et réconciliation.

## 6.2 Flux — Pipeline de transaction

```
1. INITIATION
   ├── Source : Tontines, Paiements, Wallet, API Gateway
   ├── Création de la transaction avec clé d'idempotence
   └── Statut → PENDING

2. VALIDATION
   ├── Solde suffisant (→ Wallet Service)
   ├── KYC valide (→ Membres Service)
   ├── Limites journalières/mensuelles (→ Conformité)
   ├── Scoring fraude (→ Fraud Service)
   ├── Cohérence des données (montant > 0, devise, identifiants)
   ├── Si tout OK → Statut → VALIDATED
   └── Si échec → Statut → REJECTED, motif enregistré

3. EXÉCUTION
   ├── Débit du wallet source
   ├── Crédit du wallet destination
   ├── Opération ACID PostgreSQL (isolation SERIALIZABLE)
   ├── Statut → COMPLETED
   └── Si erreur technique → ROLLBACK, Statut → FAILED

4. POST-TRAITEMENT
   ├── Émission événement transaction.completed/failed
   ├── Écriture dans le journal d'audit
   └── Mise à jour des agrégats (réconciliation)
```

## 6.3 Machine à états — Transaction

```
┌─────────┐
│ PENDING │
└────┬────┘
     │ validation
     ├──────────────────────┐
     ▼                      ▼
┌───────────┐          ┌──────────┐
│ VALIDATED │          │ REJECTED │ (terminal)
└─────┬─────┘          └──────────┘
      │ exécution
      ├──────────────────────┐
      ▼                      ▼
┌───────────┐          ┌──────────┐
│ COMPLETED │          │  FAILED  │
└─────┬─────┘          └────┬─────┘
      │ annulation           │ compensation
      ▼                      ▼
┌──────────┐           ┌──────────┐
│ REVERSED │           │ REFUNDED │
└──────────┘           └──────────┘
```

## 6.4 Événements émis

| Événement | Payload |
|---|---|
| `transaction.initiated` | txId, type, amount, currency, initiator, beneficiary, context |
| `transaction.validated` | txId |
| `transaction.completed` | txId, completedAt, walletMovementIds[] |
| `transaction.failed` | txId, failureReason, failureCode |
| `transaction.rejected` | txId, rejectionReason, rejectionRule |
| `transaction.reversed` | txId, reversalTxId, reason |

## 6.5 Règles métier

- R-TRX-01 : Chaque transaction utilise une clé d'idempotence unique pour éviter les doublons en cas de retry
- R-TRX-02 : Une transaction liée à une tontine doit respecter l'ordre du cycle en cours
- R-TRX-03 : Une transaction bloquée par le scoring fraude est mise en `REJECTED` avec alerte
- R-TRX-04 : Une transaction `FAILED` déclenche une compensation automatique (reverse du débit si le crédit a échoué)
- R-TRX-05 : Les transactions sont ACID via PostgreSQL avec isolation `SERIALIZABLE` pour les opérations wallet
- R-TRX-06 : Le temps d'exécution doit être < 200 ms pour les transactions internes
- R-TRX-07 : Les métadonnées d'audit (IP, device, timestamp, région) sont obligatoires sur chaque transaction

---

# SERVICE 7 — PAIEMENTS (PSP)

## 7.1 Objectif

Passerelle entre l'argent réel et l'écosystème interne. Gère l'intégration avec les prestataires de paiement externes pour les dépôts et retraits.

## 7.2 PSP supportés — Matrice

| PSP | Type | Régions | Dépôt | Retrait |
|---|---|---|---|---|
| **Flutterwave** | Mobile Money + Cartes | Afrique de l'Ouest/Centrale | ✅ | ✅ |
| **Paystack** | Mobile Money + Cartes | Nigeria, Ghana, Afrique du Sud | ✅ | ✅ |
| **Orange Money API** | Mobile Money | Afrique francophone | ✅ | ✅ |
| **MTN MoMo API** | Mobile Money | Afrique de l'Ouest/Centrale/Est | ✅ | ✅ |
| **Stripe** | Cartes internationales | Global | ✅ | ✅ |

## 7.3 Flux — Dépôt (Cash-in)

```
1. Le membre initie un dépôt depuis l'interface
   ├── Choix du montant et du mode de paiement (Mobile Money / Carte)
   └── Le système détermine le PSP selon le pays et le mode choisi

2. Validation pré-paiement
   ├── KYC vérifié
   ├── Conformité OK (limites, pays)
   ├── Scoring fraude < seuil
   └── Si échec → rejet avec motif

3. Création du paiement en statut PENDING
   └── Événement payment.initiated émis

4. Envoi de la requête au PSP
   ├── Mobile Money : USSD push au numéro du membre (le membre confirme sur son téléphone)
   ├── Carte : redirection vers la page de paiement sécurisée du PSP (3D Secure)
   └── Statut → PROCESSING

5. Réception du callback PSP
   ├── Succès : statut → COMPLETED
   │   ├── Transaction interne créée (crédit wallet)
   │   ├── Événement payment.completed émis
   │   └── Notification au membre
   │
   ├── Échec : statut → FAILED
   │   ├── Événement payment.failed émis
   │   ├── Retry automatique si erreur technique (max 3 tentatives)
   │   └── Fallback vers PSP alternatif si disponible
   │
   └── Timeout (pas de callback après 5 min) :
       ├── Polling du statut auprès du PSP
       └── Si toujours inconnu après 15 min → EXPIRED
```

## 7.4 Flux — Retrait (Cash-out)

```
1. Le membre initie un retrait
   ├── Montant et destination (numéro Mobile Money ou compte bancaire)

2. Validation
   ├── Solde wallet disponible ≥ montant + frais
   ├── KYC vérifié
   ├── Limites de retrait respectées
   └── Si OK → blocage du montant sur le wallet (hold)

3. Envoi de la requête au PSP
   ├── Le PSP effectue le virement vers le compte du membre
   └── Statut → PROCESSING

4. Callback PSP
   ├── Succès : hold converti en débit, statut → COMPLETED
   ├── Échec : hold annulé, fonds rendus disponibles, statut → FAILED
   └── Retry si erreur technique
```

## 7.5 Machine à états — Paiement

```
┌──────────┐
│ PENDING  │ Créé, en attente d'envoi au PSP
└────┬─────┘
     │ envoyé au PSP
     ▼
┌─────────────┐
│ PROCESSING  │ En cours chez le PSP
└──────┬──────┘
       │            │           │           │
       │ succès     │ échec     │ timeout   │ annulé
       ▼            ▼           ▼           ▼
┌───────────┐ ┌────────┐ ┌─────────┐ ┌───────────┐
│ COMPLETED │ │ FAILED │ │ EXPIRED │ │ CANCELLED │
└─────┬─────┘ └────────┘ └─────────┘ └───────────┘
      │ remboursement
      ▼
┌──────────┐
│ REFUNDED │
└──────────┘
```

## 7.6 Événements et règles métier

**Événements émis** : `payment.initiated`, `payment.processing`, `payment.completed`, `payment.failed`, `payment.refunded`, `payment.expired`

**Règles** :
- R-PAY-01 : Un paiement ne peut être initié que si l'utilisateur est KYC vérifié
- R-PAY-02 : Un retrait nécessite un solde suffisant (hold préalable obligatoire)
- R-PAY-03 : En cas d'échec technique, le système retry 3 fois avec backoff exponentiel (1s, 4s, 16s)
- R-PAY-04 : Si le PSP principal est indisponible (circuit breaker ouvert), fallback automatique
- R-PAY-05 : La réconciliation avec les relevés PSP est exécutée quotidiennement
- R-PAY-06 : Aucune donnée de carte n'est stockée côté TontineMoney (tokenisation PSP)

---

# SERVICE 8 — ALERTES & NOTIFICATIONS

## 8.1 Objectif

Orchestrer la génération, personnalisation et diffusion de toutes les notifications.

## 8.2 Catalogue de notifications

| Catégorie | Événement déclencheur | Canal par défaut | Priorité |
|---|---|---|---|
| **Tontine** | `tontine.cycle.started` | SMS + Push | Haute |
| **Tontine** | `tontine.contribution.due` | SMS | Haute |
| **Tontine** | `tontine.contribution.late` | SMS + Email | Urgente |
| **Paiement** | `payment.completed` | Push + In-app | Moyenne |
| **Paiement** | `payment.failed` | SMS + Push | Haute |
| **Wallet** | `wallet.balance.updated` | In-app | Basse |
| **KYC** | `kyc.verified` | Email + Push | Moyenne |
| **KYC** | `kyc.rejected` | SMS + Email | Haute |
| **Sécurité** | `user.login` (nouveau device) | SMS | Urgente |
| **Sécurité** | `fraud.user.flagged` | SMS + Email | Urgente |
| **Admin** | `user.approval.requested` | Email + Push | Moyenne |

## 8.3 Pipeline de notification

1. Réception de l'événement métier via le bus
2. Résolution du template selon : type d'événement + langue du membre + pays
3. Injection des variables dynamiques (nom, montant, date, nom de tontine)
4. Application des préférences du membre (canal, heures calmes, types autorisés)
5. Si heure calme : mise en file d'attente programmée
6. Envoi au Service Communication (broker) avec le canal, le contenu formaté et la priorité
7. Journalisation : notificationId, memberId, channel, status, sentAt

## 8.4 Règles métier

- R-NOT-01 : Les notifications urgentes (fraude, paiement échoué) ignorent les heures calmes
- R-NOT-02 : Aucune donnée sensible dans les SMS (pas de montant exact, pas de numéro de compte)
- R-NOT-03 : Les rappels de contribution respectent le fuseau horaire du membre
- R-NOT-04 : Le membre peut désactiver les notifications non critiques mais pas les notifications de sécurité

---

# SERVICE 9 — COMMUNICATION (BROKER SMS/EMAIL)

## 9.1 Objectif

Acheminer les messages vers les fournisseurs SMS et email avec résilience, suivi de livraison et conformité.

## 9.2 Architecture du broker

```
Service Notifications ──► Message Queue (SQS/Kafka)
                              │
                    ┌─────────┴─────────┐
                    │   Priority Queue   │ (fraude, sécurité)
                    │   Standard Queue   │ (tontine, paiement)
                    │   Bulk Queue       │ (rapports, rappels)
                    └─────────┬─────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Message Worker   │
                    │   (pool de workers)│
                    └─────────┬─────────┘
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
          ┌─────────┐   ┌──────────┐   ┌─────────┐
          │ Twilio / │   │ SendGrid │   │  AWS    │
          │ Africa's │   │ / SES    │   │  SNS    │
          │ Talking  │   │          │   │  (Push) │
          └─────────┘   └──────────┘   └─────────┘
               │              │              │
               └──────────────┼──────────────┘
                              │
                    Delivery Reports (callbacks)
                              │
                    ┌─────────┴─────────┐
                    │ Statut mis à jour  │
                    │ DLQ si échec final │
                    └───────────────────┘
```

## 9.3 Règles métier

- R-COM-01 : SMS limité à 160 caractères, sans accents pour certains pays
- R-COM-02 : Les messages échoués sont retentés 3 fois avec backoff, puis envoyés en DLQ
- R-COM-03 : Limite anti-spam : max 10 SMS/jour par utilisateur (hors urgences)
- R-COM-04 : Le fournisseur est choisi selon le pays du destinataire et la disponibilité
- R-COM-05 : Les messages de la file prioritaire sont traités en < 5 secondes

---

# SERVICE 10 — CONFORMITÉ

## 10.1 Objectif

Appliquer dynamiquement les règles réglementaires par pays, région et langue. Valider chaque opération financière avant exécution.

## 10.2 Catalogue de règles par pays (exemples)

| Pays | Limite transaction/jour | Limite wallet | KYC minimum | Tontines autorisées | Langues |
|---|---|---|---|---|---|
| Cameroun (CM) | 1 000 000 XAF | 5 000 000 XAF | TIER_2 | Oui | fr-CM |
| Côte d'Ivoire (CI) | 2 000 000 XOF | 10 000 000 XOF | TIER_2 | Oui | fr-CI |
| Nigeria (NG) | 500 000 NGN | 2 000 000 NGN | TIER_2 | Oui | en-NG |
| RD Congo (CD) | 1 000 USD | 5 000 USD | TIER_2 | Oui | fr-CD |
| France (FR) | 3 000 EUR | 10 000 EUR | TIER_3 | Sous conditions | fr-FR |
| Canada (CA) | 3 000 CAD | 10 000 CAD | TIER_3 | Sous conditions | fr-CA, en-CA |

## 10.3 API de validation

Le service expose un endpoint synchrone appelé par les autres services avant chaque opération :

```
POST /api/v1/compliance/validate
{
  "operation_type": "TONTINE_CONTRIBUTION",
  "member_id": "uuid-...",
  "amount": 50000,
  "currency": "XAF",
  "country": "CM",
  "context": { "tontine_id": "uuid-..." }
}

Response 200 (OK):
{
  "compliant": true,
  "applied_rules": ["CM-DAILY-LIMIT", "CM-KYC-TIER2"]
}

Response 200 (Blocked):
{
  "compliant": false,
  "violations": [
    { "rule": "CM-DAILY-LIMIT", "message": "Daily limit exceeded", "limit": 1000000, "current": 980000 }
  ]
}
```

## 10.4 Règles métier

- R-CMP-01 : Chaque opération financière DOIT être validée par le service Conformité avant exécution
- R-CMP-02 : Les règles sont modifiables dynamiquement sans redéploiement (table de configuration)
- R-CMP-03 : Toute violation est journalisée et signalée
- R-CMP-04 : Les communications doivent respecter la langue obligatoire du pays

---

# SERVICE 11 — RAPPORTS

## 11.1 Objectif

Fournir une vision consolidée des activités via des rapports financiers, opérationnels, réglementaires et analytiques.

## 11.2 Types de rapports

| Rapport | Fréquence | Destinataire | Format |
|---|---|---|---|
| Bilan de tontine (par tour) | À chaque fin de cycle | Admin tontine, membres | PDF, CSV |
| Bilan mensuel de tontine | Mensuel | Admin tontine | PDF |
| Réconciliation PSP | Quotidien | Équipe finance | CSV, JSON |
| Rapport KYC/AML | Mensuel | Compliance officer | PDF |
| Transactions suspectes | Temps réel | Fraude team | JSON, Dashboard |
| Activité membres | Hebdomadaire | Équipe produit | Dashboard |
| Rapport fiscal annuel | Annuel | Admin plateforme | PDF |

## 11.3 Architecture CQRS

Le service Rapports ne lit jamais les bases des services transactionnels. Il maintient ses propres vues matérialisées alimentées par les événements du bus. Cela garantit l'isolation et la performance (aucune requête lourde sur les bases de production).

---

# SERVICE 12 — TRADUCTION AUTOMATIQUE

## 12.1 Objectif

Traduire automatiquement les contenus dynamiques dans la langue de l'utilisateur, avec cohérence terminologique.

## 12.2 Glossaire métier (extrait)

| Terme FR | EN | Contexte |
|---|---|---|
| Tontine | Tontine / Savings circle | Nom du produit |
| Cotisation | Contribution | Paiement périodique |
| Tour | Cycle / Round | Période d'une tontine |
| Bénéficiaire | Beneficiary | Membre recevant le pot |
| Cagnotte | Pool / Pot | Somme totale collectée |
| Mise à prise | Bid / Auction fee | Tontine avec enchères |
| Portefeuille | Wallet | Compte virtuel |
| Cotisation cagnotte | Pool contribution | Contribution au pot commun |
| Droit d'entrée | Membership fee | Frais d'adhésion |

## 12.3 Pipeline de traduction

1. Le service reçoit un texte avec sa langue source et la langue cible
2. Vérification du cache Redis (clé = hash du texte + langues)
3. Si cache hit → retour immédiat
4. Si cache miss → appel au provider de traduction (AWS Translate / Google)
5. Application du glossaire métier (post-processing : remplacement des termes standardisés)
6. Mise en cache du résultat (TTL = 24h)
7. Retour du texte traduit

## 12.4 Règles métier

- R-TRD-01 : La langue du membre est toujours prioritaire
- R-TRD-02 : Le glossaire métier a priorité sur la traduction automatique
- R-TRD-03 : Le cache est invalidé quand le glossaire est mis à jour
- R-TRD-04 : En cas d'indisponibilité du provider, la langue source est utilisée en fallback
- R-TRD-05 : Les messages critiques (sécurité, fraude) sont traduits en priorité

---

# MATRICE COMPLÈTE DES ÉVÉNEMENTS INTER-SERVICES

| Événement | Producteur | Consommateurs |
|---|---|---|
| `user.registered` | Auth | Membres |
| `user.login` | Auth | Audit, Fraude |
| `member.created` | Membres | KYC, Wallet, Tontines |
| `member.updated` | Membres | Tontines, Notifications, Traduction |
| `member.status.changed` | Membres | Auth, Tontines, Transactions, Paiements |
| `member.suspended` | Membres | Auth, Tontines, Wallet, Notifications |
| `kyc.submitted` | KYC | Membres, Notifications |
| `kyc.verified` | KYC | Membres, Tontines, Conformité, Wallet |
| `kyc.rejected` | KYC | Membres, Notifications |
| `kyc.expired` | KYC | Membres, Notifications, Tontines |
| `kyc.duplicate.detected` | KYC | Fraude, Membres |
| `tontine.created` | Tontines | Notifications |
| `tontine.started` | Tontines | Notifications, Rapports |
| `tontine.cycle.started` | Tontines | Transactions, Notifications, Rapports |
| `tontine.contribution.due` | Tontines | Notifications |
| `tontine.contribution.received` | Tontines | Notifications, Rapports |
| `tontine.contribution.late` | Tontines | Notifications |
| `tontine.cycle.completed` | Tontines | Rapports, Notifications |
| `tontine.closed` | Tontines | Rapports, Notifications |
| `wallet.created` | Wallet | — |
| `wallet.balance.updated` | Wallet | Tontines, Transactions, Paiements, Rapports |
| `wallet.hold.created` | Wallet | — |
| `wallet.hold.released` | Wallet | — |
| `wallet.debit.failed` | Wallet | Notifications, Tontines |
| `transaction.initiated` | Transactions | Conformité |
| `transaction.completed` | Transactions | Wallet, Paiements, Rapports |
| `transaction.failed` | Transactions | Wallet, Notifications |
| `transaction.reversed` | Transactions | Wallet |
| `payment.initiated` | Paiements | Notifications |
| `payment.completed` | Paiements | Transactions, Wallet, Notifications, Rapports |
| `payment.failed` | Paiements | Transactions, Notifications |
| `payment.refunded` | Paiements | Transactions, Wallet, Notifications |
| `compliance.rule.updated` | Conformité | Tous les services |
| `compliance.violation.detected` | Conformité | Membres, Notifications, Fraude |
| `compliance.user.suspended` | Conformité | Auth, Membres |
| `notification.created` | Notifications | Communication |
| `notification.sent` | Notifications | — |
| `sms.sent` / `sms.failed` | Communication | Notifications |
| `email.sent` / `email.bounced` | Communication | Notifications |
| `translation.completed` | Traduction | Notifications |
| `report.generated` | Rapports | Notifications |




