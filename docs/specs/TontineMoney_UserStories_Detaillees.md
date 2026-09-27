# TontineMoney — Récits de Développement Détaillés

## 55 User Stories · 10 Épiques · Itération 1 (MVP)

---

# ÉPIQUE 1 — AUTHENTIFICATION & ACCÈS

---

## US-1.1 · Création d'un compte admin de tontine

**En tant que** super-administrateur de la plateforme,
**je veux** pouvoir créer un compte administrateur de tontine,
**afin de** lui donner accès aux fonctionnalités de gestion de sa tontine.

**Points** : 5 · **Priorité** : Critique · **Sprint** : 1

### Critères d'acceptation détaillés

1. Le super-admin accède à un formulaire de création contenant : nom, prénom, email, téléphone, pays, langue, nom de la tontine associée
2. Le système valide que l'email et le téléphone ne sont pas déjà associés à un compte existant
3. Le système crée le compte en statut `PENDING_ACTIVATION`
4. Le système génère un lien d'activation unique (UUID v4) avec une durée de validité de 48 heures
5. Le système envoie le lien par email ET par SMS (double canal pour fiabilité)
6. L'événement `user.registered` est émis avec le rôle `TONTINE_ADMIN`
7. Le super-admin voit la confirmation de création dans son tableau de bord
8. Le nouvel admin reçoit l'email/SMS dans un délai < 30 secondes

### Règles métier

- Un admin de tontine ne peut gérer qu'une seule tontine à la création (il peut en créer d'autres par la suite)
- Le super-admin peut créer plusieurs admins pour la même tontine
- Le lien d'activation ne peut être utilisé qu'une seule fois
- Après 48h sans activation, le lien expire et le super-admin doit en régénérer un nouveau

### Dépendances

- Service Communication (SMS/Email) pour l'envoi du lien
- Service Membres pour la création du profil associé

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Nominal | Données valides | Compte créé, lien envoyé, statut PENDING_ACTIVATION |
| Email existant | Email déjà en base | Erreur 409, message "Email déjà utilisé" |
| Téléphone invalide | Format non E.164 | Erreur 400, message "Format téléphone invalide" |
| Champs manquants | Nom vide | Erreur 400, liste des champs manquants |
| Envoi SMS échoué | Provider SMS indisponible | Lien envoyé par email uniquement, alerte interne |

### Notes techniques

- Endpoint : `POST /api/v1/admin/tontine-admins`
- Autorisation : rôle `SUPER_ADMIN` requis
- Le lien d'activation suit le format : `https://app.tontinemoney.com/activate/{token}`
- Le token est stocké haché (SHA-256) en base

---

## US-1.2 · Inscription d'un membre par l'admin

**En tant qu'** administrateur de tontine,
**je veux** inscrire un membre avec ses informations de base,
**afin qu'** il puisse rejoindre ma tontine.

**Points** : 5 · **Priorité** : Critique · **Sprint** : 1

### Critères d'acceptation détaillés

1. L'admin accède au formulaire d'inscription membre depuis le tableau de bord de sa tontine
2. Champs requis : nom, prénom, email OU téléphone (au moins un), canal de communication préféré (SMS ou email)
3. Champs optionnels : date de naissance, adresse, pays (déduit du téléphone si absent)
4. Le système vérifie l'unicité de l'identifiant (email/téléphone) sur toute la plateforme
5. Le système crée le profil membre en statut `PENDING_ACTIVATION`
6. Le système génère un OTP à 6 chiffres (validité 15 minutes) ou un lien d'activation (validité 48h) selon le canal choisi
7. Le code/lien est envoyé via le canal préféré du membre
8. L'événement `user.registered` est émis avec le contexte `registeredBy: adminId, tontineId`
9. L'admin voit le nouveau membre apparaître dans sa liste avec le statut `PENDING_ACTIVATION`
10. Le membre inscrit est pré-associé à la tontine de l'admin en attente d'activation

### Règles métier

- Un admin ne peut inscrire un membre que dans les tontines qu'il administre
- Le système déduit le pays à partir de l'indicatif téléphonique (+237 → CM, +225 → CI, etc.)
- L'OTP est composé de chiffres uniquement, sans caractères ambigus
- Maximum 3 renvois d'OTP par heure pour éviter le spam SMS
- L'inscription d'un membre ne déclenche PAS le KYC automatiquement ; le membre le fera lui-même après activation

### Dépendances

- US-1.1 (l'admin doit avoir un compte actif)
- Service Communication pour l'envoi
- Service Membres pour la création du profil

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Nominal email | Nom + email valides | Profil créé, lien envoyé par email |
| Nominal SMS | Nom + téléphone valide | Profil créé, OTP envoyé par SMS |
| Doublon email | Email déjà existant | Erreur 409, "Ce membre existe déjà" |
| Admin non autorisé | Admin d'une autre tontine | Erreur 403, accès refusé |
| Ni email ni téléphone | Les deux vides | Erreur 400, "Au moins un identifiant requis" |
| OTP expiré | Validation après 15 min | Erreur 410, "Code expiré, demandez un renvoi" |
| OTP invalide | Mauvais code 3 fois | Blocage temporaire 15 min, notification admin |

### Notes techniques

- Endpoint : `POST /api/v1/tontines/{tontineId}/members`
- Autorisation : rôle `TONTINE_ADMIN` + ownership de la tontine
- L'OTP est stocké haché (bcrypt) en base avec un compteur de tentatives
- Taux limite : 50 inscriptions/heure par admin

---

## US-1.3 · Demande de compte par un utilisateur invité

**En tant qu'** utilisateur invité,
**je veux** pouvoir demander la création d'un compte,
**afin de** rejoindre une tontine.

**Points** : 3 · **Priorité** : Haute · **Sprint** : 2

### Critères d'acceptation détaillés

1. L'utilisateur accède à la page publique d'inscription via un lien ou l'URL directe
2. Il remplit le formulaire : nom, prénom, email, téléphone, canal de communication préféré
3. Il peut optionnellement indiquer un code d'invitation ou le nom de la tontine qu'il souhaite rejoindre
4. Le système valide les données (format, unicité)
5. Le système crée un compte en statut `PENDING_APPROVAL`
6. L'événement `user.approval.requested` est émis
7. L'administrateur de la tontine ciblée (ou le super-admin si pas de tontine spécifiée) reçoit une notification de demande
8. L'utilisateur voit un message de confirmation : "Votre demande est en cours de validation"
9. Aucun accès aux fonctionnalités n'est accordé tant que la demande n'est pas approuvée

### Règles métier

- Un utilisateur invité ne peut pas soumettre plus de 3 demandes non traitées simultanément
- Si l'email ou le téléphone correspond à un compte existant : message "Un compte existe déjà avec cet identifiant"
- La demande expire automatiquement après 30 jours sans traitement
- Le système ne révèle pas si un email spécifique est déjà enregistré (protection vie privée) — le message est générique

### Dépendances

- US-1.1 / US-10.1 (un admin doit pouvoir valider)
- Service Notifications pour l'alerte à l'admin

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Nominal | Données valides + code invitation | Demande créée, admin notifié |
| Sans code invitation | Données valides seules | Demande créée, super-admin notifié |
| Email existant | Email déjà en base | Erreur générique (pas de fuite d'info) |
| Captcha échoué | Bot/spam détecté | Demande rejetée silencieusement |
| Expiration | Demande non traitée 30j | Statut → EXPIRED, notification utilisateur |

### Notes techniques

- Endpoint : `POST /api/v1/auth/request-account`
- Pas d'authentification requise (endpoint public)
- Protection anti-bot : reCAPTCHA v3 ou hCaptcha
- Rate limiting : 5 demandes/heure par IP

---

## US-1.4 · Connexion et déconnexion sécurisée

**En tant qu'** utilisateur enregistré,
**je veux** me connecter et me déconnecter de manière sécurisée,
**afin d'** accéder à mon compte en toute sécurité.

**Points** : 5 · **Priorité** : Critique · **Sprint** : 1

### Critères d'acceptation détaillés

1. L'utilisateur saisit son identifiant (email ou téléphone) et son mot de passe
2. Le système vérifie les identifiants via comparaison bcrypt
3. Si les identifiants sont valides et MFA désactivé :
   - Génération d'un `access_token` JWT (RS256, durée 15 min)
   - Génération d'un `refresh_token` opaque (UUID v4, durée 7 jours)
   - Le `refresh_token` est stocké haché en base, associé au device (User-Agent + IP)
   - Événement `user.login` émis avec : userId, IP, User-Agent, timestamp, mfaUsed=false
4. Si les identifiants sont valides et MFA activé :
   - Le système retourne un `mfa_challenge_token` temporaire (validité 5 min)
   - L'utilisateur saisit le code TOTP ou le code SMS
   - Si code MFA valide → génération des tokens comme ci-dessus avec mfaUsed=true
   - Si code MFA invalide → compteur de tentatives incrémenté
5. Si les identifiants sont invalides :
   - Message générique "Identifiants incorrects" (pas de distinction email/mot de passe)
   - Compteur de tentatives échouées incrémenté
   - Après 5 échecs en 10 min → verrouillage temporaire 15 min
   - Après 15 échecs en 1h → verrouillage du compte + notification
6. Rafraîchissement du token :
   - Endpoint dédié acceptant le `refresh_token`
   - Génère un nouveau `access_token` (rotation)
   - Le `refresh_token` est consommé et remplacé (rotation de refresh token)
7. Déconnexion :
   - Le `refresh_token` est révoqué en base
   - L'`access_token` est ajouté à la blacklist Redis (TTL = durée restante du token)
   - Événement `user.logout` émis

### Règles métier

- R-AUTH-LOGIN-01 : Le message d'erreur ne doit jamais révéler si c'est l'email ou le mot de passe qui est incorrect
- R-AUTH-LOGIN-02 : Un compte verrouillé ne peut être déverrouillé que par un admin ou après expiration du délai de verrouillage
- R-AUTH-LOGIN-03 : Un utilisateur peut avoir maximum 5 sessions actives simultanées (5 devices). Au-delà, la session la plus ancienne est révoquée
- R-AUTH-LOGIN-04 : Si connexion depuis un nouveau device (User-Agent inconnu), notification de sécurité envoyée
- R-AUTH-LOGIN-05 : Les tokens JWT contiennent : userId, role, tontineIds[], iat, exp

### Dépendances

- Redis pour la blacklist des tokens et le rate limiting
- Service Notifications pour les alertes de sécurité

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Login nominal | Bon email + bon mdp | Tokens générés, événement émis |
| Login + MFA TOTP | Bon email + bon mdp + bon code | Tokens après MFA |
| Login + MFA SMS | Bon email + bon mdp + OTP SMS | SMS envoyé, tokens après saisie |
| Mauvais mdp | Bon email + mauvais mdp | Erreur 401, compteur++ |
| Compte verrouillé | 6e tentative en 10 min | Erreur 423, "Compte temporairement verrouillé" |
| Refresh token | Refresh token valide | Nouveau access_token |
| Refresh token expiré | Token de 8 jours | Erreur 401, re-login nécessaire |
| Déconnexion | Access + refresh tokens | Tokens révoqués, 204 No Content |
| Nouveau device | Login depuis IP/UA inconnu | Tokens + notification sécurité |

### Notes techniques

- Endpoints :
  - `POST /api/v1/auth/login` → { accessToken, refreshToken }
  - `POST /api/v1/auth/login/mfa` → { accessToken, refreshToken }
  - `POST /api/v1/auth/refresh` → { accessToken, refreshToken }
  - `POST /api/v1/auth/logout` → 204
- JWT signé RS256 avec rotation des clés (JWKS)
- Rate limiting login : 10 tentatives/min par IP, 5/10min par compte
- Le refresh token n'est jamais exposé côté client en localStorage — cookie HttpOnly Secure SameSite=Strict

---

## US-1.5 · Réinitialisation de mot de passe

**En tant qu'** utilisateur,
**je veux** pouvoir réinitialiser mon mot de passe,
**afin de** retrouver l'accès à mon compte si j'ai oublié mes identifiants.

**Points** : 3 · **Priorité** : Haute · **Sprint** : 2

### Critères d'acceptation détaillés

1. L'utilisateur accède à la page "Mot de passe oublié" et saisit son email ou téléphone
2. Le système vérifie si l'identifiant existe (mais ne le révèle PAS à l'utilisateur)
3. Si l'identifiant existe : génération d'un token unique (UUID v4, validité 1 heure), envoi par email ou SMS
4. Si l'identifiant n'existe pas : même message affiché ("Si un compte existe, un lien vous a été envoyé") — pas de fuite d'information
5. L'utilisateur clique sur le lien et accède au formulaire de nouveau mot de passe
6. Le système vérifie : token valide, non expiré, non déjà utilisé
7. Le système valide le nouveau mot de passe (règles de complexité) et vérifie qu'il ne fait pas partie des 5 derniers mots de passe
8. Le mot de passe est mis à jour (bcrypt, cost ≥ 12)
9. Toutes les sessions actives de l'utilisateur sont invalidées
10. Le token est marqué comme consommé
11. Événement `user.password.reset` émis
12. Notification de confirmation envoyée au membre

### Règles métier

- Maximum 3 demandes de réinitialisation par heure par identifiant
- Le lien de réinitialisation est à usage unique
- Après réinitialisation, toutes les sessions (tous les devices) sont fermées
- Le nouveau mot de passe ne peut pas être identique aux 5 derniers

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Nominal | Email existant | Lien envoyé, message générique affiché |
| Email inexistant | Email pas en base | Même message générique (pas de fuite) |
| Token expiré | Clic après 1h | Page "Lien expiré, refaites une demande" |
| Token déjà utilisé | Deuxième clic | Page "Lien déjà utilisé" |
| Mdp trop simple | "123456" | Erreur "Le mot de passe ne respecte pas les critères" |
| Mdp identique ancien | Même que l'actuel | Erreur "Le mot de passe doit être différent des 5 derniers" |

### Notes techniques

- Endpoints :
  - `POST /api/v1/auth/forgot-password` → 200 (toujours, même si email inexistant)
  - `POST /api/v1/auth/reset-password` → { token, newPassword }
- Le token est stocké haché (SHA-256) en base avec expiration et compteur d'utilisation

---

## US-1.6 · Activation du MFA

**En tant qu'** utilisateur,
**je veux** activer l'authentification multi-facteurs,
**afin de** renforcer la sécurité de mon compte.

**Points** : 5 · **Priorité** : Moyenne · **Sprint** : 3

### Critères d'acceptation détaillés

1. L'utilisateur accède aux paramètres de sécurité de son compte
2. Il choisit le mode MFA :
   - **TOTP** : le système génère un secret (base32, 160 bits), affiche un QR code compatible avec Google Authenticator / Authy. L'utilisateur scanne et saisit un code de vérification pour confirmer l'activation
   - **SMS** : le système envoie un OTP au numéro enregistré. L'utilisateur saisit le code
3. Si le code est valide : MFA activé, préférence stockée
4. Le système génère 10 codes de récupération à usage unique (format : XXXX-XXXX, alphanumériques)
5. Les codes de récupération sont affichés UNE SEULE FOIS et l'utilisateur doit confirmer les avoir sauvegardés
6. Événement `user.mfa.enabled` émis
7. Notification de confirmation envoyée
8. Désactivation du MFA : nécessite la saisie du mot de passe + un code MFA valide

### Règles métier

- Le MFA est optionnel pour les membres, recommandé pour les admins de tontine, obligatoire pour le super-admin
- Les codes de récupération sont stockés hachés (bcrypt) — impossible de les réafficher
- Un code de récupération utilisé est immédiatement invalidé
- Si tous les codes de récupération sont utilisés, le système force la régénération
- La désactivation du MFA déclenche une notification d'alerte

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Activation TOTP | QR scanné + bon code | MFA activé, 10 codes de récupération |
| Activation SMS | Bon OTP SMS | MFA activé, 10 codes de récupération |
| Mauvais code TOTP | Code erroné | Erreur, MFA non activé |
| Login avec TOTP | Email + mdp + code TOTP | Connexion réussie |
| Login avec code récup | Email + mdp + code récup | Connexion + code consommé |
| Désactivation | Mdp + code MFA valide | MFA désactivé, notification envoyée |
| Dernier code récup | 10e code utilisé | Alerte + obligation de régénérer |

### Notes techniques

- Endpoint : `POST /api/v1/auth/mfa/enable` → { qrCodeUrl, recoveryCodes[] }
- Endpoint : `POST /api/v1/auth/mfa/verify` → { success }
- Endpoint : `POST /api/v1/auth/mfa/disable` → 204
- Librairie TOTP : `otpauth` (RFC 6238, période 30s, 6 chiffres)

---

# ÉPIQUE 2 — GESTION DES MEMBRES

---

## US-2.1 · Création automatique du profil membre

**En tant que** système,
**je veux** créer automatiquement un profil membre à l'inscription,
**afin de** disposer d'un registre centralisé de tous les utilisateurs.

**Points** : 3 · **Priorité** : Critique · **Sprint** : 1

### Critères d'acceptation détaillés

1. Le service écoute l'événement `user.registered` sur le bus
2. À la réception, il crée un enregistrement `Member` avec :
   - `id` : UUID v4 unique
   - `first_name`, `last_name` : copiés depuis l'événement
   - `email`, `phone` : copiés depuis l'événement
   - `country_code` : déduit du préfixe téléphonique ou du champ pays de l'événement
   - `language` : langue par défaut du pays (ex: CM → fr-CM)
   - `timezone` : fuseau par défaut du pays (ex: CM → Africa/Douala)
   - `status` : `PENDING`
   - `kyc_level` : `NONE`
   - `notification_prefs` : valeurs par défaut du pays
   - `version` : 1
3. L'événement `member.created` est émis avec : memberId, country, language, status
4. Le traitement est idempotent : si un profil existe déjà pour cet userId, l'événement est ignoré (pas de doublon)
5. Le temps de traitement est < 500 ms entre la réception de l'événement et l'émission de `member.created`

### Règles métier

- Le pays est obligatoire — s'il ne peut pas être déduit, le statut reste PENDING et le membre sera invité à le compléter
- La correspondance préfixe → pays suit la norme ITU-T E.164
- Chaque pays a un mapping vers une langue et un fuseau par défaut (table de configuration)

### Dépendances

- US-1.1 / US-1.2 / US-1.3 (émission de `user.registered`)
- Table de référence pays → langue → fuseau

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Nominal | Event user.registered complet | Profil créé, member.created émis |
| Téléphone +237 | Préfixe Cameroun | country_code=CM, language=fr-CM |
| Téléphone +1 | Préfixe Canada/US | country_code=CA (défaut), language=fr-CA |
| Doublon | Même event reçu 2 fois | Premier traité, second ignoré |
| Sans téléphone | Email uniquement | country_code à NULL, status PENDING |

---

## US-2.2 · Complétion du profil membre

**En tant que** membre,
**je veux** compléter mon profil avec mes informations personnelles,
**afin de** pouvoir accéder aux fonctionnalités de la plateforme.

**Points** : 3 · **Priorité** : Haute · **Sprint** : 2

### Critères d'acceptation détaillés

1. Le membre accède à son profil et peut modifier : téléphone, email, pays, ville, adresse, date de naissance, genre, langue, fuseau horaire, photo de profil
2. Chaque champ est validé individuellement (format email RFC 5322, téléphone E.164, pays ISO 3166-1, date de naissance > 18 ans pour les opérations financières)
3. La modification est sauvegardée avec versionnement : `old_values` et `new_values` stockés dans `MemberAuditLog`
4. L'événement `member.updated` est émis avec les champs modifiés uniquement (delta)
5. Si le profil atteint la complétude minimale (nom, prénom, pays, au moins un contact) et que le statut est PENDING → transition vers `KYC_REQUIRED`
6. Validation optimiste : le numéro de version est vérifié pour éviter les écritures concurrentes

### Règles métier

- Un membre ne peut pas modifier son nom/prénom après validation KYC (il faut refaire le KYC)
- Le changement de pays déclenche une réévaluation de conformité
- Le changement de langue met à jour la langue des futures communications
- La photo de profil : JPEG/PNG uniquement, max 5 Mo, redimensionnée à 400×400

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Mise à jour langue | fr-CM → en-CM | Profil mis à jour, event émis, communications futures en anglais |
| Profil complet | Tous les champs remplis | Statut → KYC_REQUIRED si était PENDING |
| Conflit de version | Version obsolète | Erreur 409 "Profil modifié entre-temps" |
| Changement nom post-KYC | KYC déjà vérifié | Erreur 403 "Modification interdite après KYC" |
| Photo trop grande | Image 15 Mo | Erreur 413 "Fichier trop volumineux" |

---

## US-2.3 · Liste des membres pour l'admin

**En tant qu'** administrateur de tontine,
**je veux** voir la liste des membres et leur statut,
**afin de** gérer efficacement ma tontine.

**Points** : 5 · **Priorité** : Haute · **Sprint** : 2

### Critères d'acceptation détaillés

1. L'admin accède à la page "Membres" de sa tontine
2. La liste affiche pour chaque membre : nom complet, email/téléphone (partiellement masqué), statut membre, niveau KYC, date d'inscription, dernière activité
3. Pagination par curseur (20 résultats par page)
4. Filtres disponibles : par statut (ACTIVE, PENDING, SUSPENDED, etc.), par niveau KYC, par date d'inscription (plage)
5. Recherche textuelle sur nom, prénom, email, téléphone (recherche partielle)
6. Tri disponible : par nom (A-Z, Z-A), par date d'inscription, par statut
7. L'admin ne voit QUE les membres de ses tontines (pas les membres d'autres tontines)
8. Les données sensibles (adresse complète, documents KYC) ne sont PAS affichées dans cette liste
9. Temps de chargement < 500 ms pour 1 000 membres

### Règles métier

- Les emails/téléphones sont partiellement masqués : `j***@email.com`, `+237 6** *** **45`
- Un admin ne peut voir que les membres associés à ses tontines
- Le compteur total est affiché : "42 membres (38 actifs, 3 en attente, 1 suspendu)"

### Notes techniques

- Endpoint : `GET /api/v1/tontines/{tontineId}/members?status=ACTIVE&search=jean&cursor=xxx&limit=20`
- Index PostgreSQL sur (tontine_id, status) et GIN trigram sur (first_name, last_name, email)

---

## US-2.4 · Validation ou refus d'un membre

**En tant qu'** administrateur de tontine,
**je veux** valider ou refuser un membre,
**afin de** contrôler qui rejoint ma tontine.

**Points** : 3 · **Priorité** : Haute · **Sprint** : 2

### Critères d'acceptation détaillés

1. L'admin voit la liste des membres en statut `PENDING_APPROVAL`
2. Pour chaque membre, il peut : voir le profil (informations non sensibles), accepter la demande, refuser la demande avec un motif obligatoire
3. Si accepté : statut → `PENDING_ACTIVATION` ou `ACTIVE_PENDING_KYC`, lien d'activation envoyé si pas encore activé, événement `member.status.changed` émis
4. Si refusé : statut → `REJECTED`, notification au membre avec le motif, la donnée est archivée (pas supprimée)
5. L'action est journalisée dans `MemberAuditLog` avec l'identité de l'admin

### Scénarios de test

| Scénario | Entrée | Résultat attendu |
|---|---|---|
| Acceptation | Admin clique "Accepter" | Statut → ACTIVE_PENDING_KYC, notification |
| Refus avec motif | "Profil incomplet" | Statut → REJECTED, notification avec motif |
| Refus sans motif | Motif vide | Erreur 400, "Le motif est obligatoire" |
| Admin non autorisé | Admin d'une autre tontine | Erreur 403 |

---

## US-2.5 · Isolation des données du membre

**En tant que** membre,
**je veux** ne voir que mes propres activités,
**afin que** mes données restent confidentielles.

**Points** : 5 · **Priorité** : Critique · **Sprint** : 1

### Critères d'acceptation détaillés

1. Un membre authentifié ne peut accéder qu'aux ressources lui appartenant
2. Toute requête API vérifie que le `userId` du token JWT correspond au propriétaire de la ressource demandée
3. Les endpoints de type `/members/{memberId}/*` rejettent avec 403 si memberId ≠ userId du token (sauf si rôle admin)
4. Les requêtes de liste (transactions, mouvements wallet) sont automatiquement filtrées par le userId du token
5. Un membre ne peut PAS voir : les profils des autres membres (sauf nom/prénom dans le contexte d'une tontine partagée), les transactions des autres, les soldes des autres wallets, les documents KYC des autres
6. Dans le contexte d'une tontine : un membre peut voir la liste des prénoms des autres membres de sa tontine et le statut de contribution de chacun (payé / en attente / retard) — mais pas les montants individuels ni les données personnelles
7. Tests de pénétration : tentative d'accès aux données d'un autre membre via manipulation d'URL, injection d'ID, etc. → toujours 403

### Notes techniques

- Middleware d'autorisation appliqué sur chaque route
- Pattern : extraire le memberId de la ressource, comparer avec le userId du JWT
- Audit log pour chaque tentative d'accès refusée (alerte si fréquence anormale)

---

## US-2.6 · Gestion des transitions de statut

**En tant que** système,
**je veux** gérer automatiquement les transitions de statut des membres,
**afin de** refléter en temps réel leur éligibilité.

**Points** : 5 · **Priorité** : Critique · **Sprint** : 2

### Critères d'acceptation détaillés

1. Le service écoute les événements : `kyc.verified`, `kyc.rejected`, `kyc.review.required`, `fraud.user.flagged`, `compliance.user.restricted`, `compliance.user.suspended`
2. Chaque événement déclenche une transition de statut selon la matrice :

| Événement | Statut actuel | Nouveau statut |
|---|---|---|
| `kyc.verified` | KYC_REQUIRED / KYC_IN_REVIEW | ACTIVE |
| `kyc.rejected` | KYC_IN_REVIEW | KYC_REJECTED |
| `kyc.review.required` | KYC_REQUIRED | KYC_IN_REVIEW |
| `fraud.user.flagged` | Tout sauf SUSPENDED | SUSPENDED |
| `compliance.user.suspended` | Tout sauf SUSPENDED | SUSPENDED |

3. Chaque transition est journalisée dans `MemberAuditLog` avec : ancien statut, nouveau statut, événement déclencheur, timestamp
4. L'événement `member.status.changed` est émis pour informer les autres services
5. Les transitions invalides sont ignorées et loguées (ex: `kyc.verified` sur un membre déjà ACTIVE)

---

# ÉPIQUE 3 — KYC

---

## US-3.1 · Soumission de pièce d'identité et selfie

**En tant que** membre,
**je veux** soumettre ma pièce d'identité et un selfie,
**afin de** faire vérifier mon identité.

**Points** : 5 · **Priorité** : Critique · **Sprint** : 2

### Critères d'acceptation détaillés

1. Le membre accède à la page KYC depuis son profil
2. Le système affiche les types de documents acceptés selon son pays :
   - Cameroun : CNI, Passeport, Permis de conduire
   - Nigeria : NIN Slip, Passeport, Voter's Card
   - etc. (table de configuration par pays)
3. Le membre sélectionne le type de document et uploade le recto (obligatoire) et le verso (si applicable)
4. Contraintes fichier : JPEG ou PNG, résolution min 1000×600, taille max 10 Mo
5. Le membre prend un selfie via la caméra du device (pas d'upload d'image existante) :
   - Le système active la caméra frontale
   - Détection de visage en temps réel (cadrage guidé)
   - Capture automatique quand le visage est bien cadré
6. Les fichiers sont uploadés vers S3 avec chiffrement côté serveur (SSE-S3 ou SSE-KMS)
7. Le statut KYC passe de `NONE` à `SUBMITTED`
8. L'événement `kyc.submitted` est émis
9. Le membre voit un message : "Vos documents sont en cours de vérification"
10. Le traitement automatique est déclenché de manière asynchrone (US-3.2)

### Règles métier

- Un membre ne peut soumettre qu'un seul dossier KYC à la fois (pas de soumissions parallèles)
- Si un KYC précédent a été rejeté, le membre peut resoumettre (historique conservé)
- Les fichiers sont stockés avec une clé liée au memberId : `kyc/{memberId}/{timestamp}/{filename}`
- Le selfie doit provenir de la caméra en direct — pas de bibliothèque photo

### Notes techniques

- Upload : presigned URL S3 pour upload direct depuis le client (évite de transiter par le backend)
- Endpoint : `POST /api/v1/kyc/submit` → { kycRequestId, status: SUBMITTED }
- Stockage : S3 bucket dédié KYC, lifecycle policy : conservation 7 ans, transition vers Glacier après 1 an

---

## US-3.2 · Vérification automatique des documents

**En tant que** système,
**je veux** vérifier automatiquement les documents KYC,
**afin de** accélérer le processus et réduire la charge manuelle.

**Points** : 13 · **Priorité** : Critique · **Sprint** : 3-4

### Critères d'acceptation détaillés

1. Le service reçoit l'événement `kyc.submitted` et déclenche le pipeline automatique
2. **Étape 1 — Qualité du document** (< 1s) :
   - Vérification que l'image n'est pas floue (score de netteté > seuil)
   - Vérification que l'image n'est pas trop sombre ou surexposée
   - Vérification de la résolution minimale
   - Si échec → résultat `QUALITY_FAILED`, recommandation de resoumettre
3. **Étape 2 — OCR** (< 2s) :
   - Extraction des champs : nom, prénom, date de naissance, numéro du document, date d'expiration, nationalité
   - Provider : Smile Identity / Onfido / Jumio (adapté au pays)
   - Les champs extraits sont stockés de manière structurée
4. **Étape 3 — Validation du document** (< 1s) :
   - Format attendu pour le type de document et le pays
   - Cohérence nom/prénom avec le profil membre (distance de Levenshtein ≤ 2)
   - Document non expiré (date d'expiration > aujourd'hui + 30 jours)
   - Détection de manipulation (retouche photo, scan d'écran, photocopie)
5. **Étape 4 — Face match** (< 2s) :
   - Comparaison biométrique selfie ↔ photo du document
   - Score de confiance calculé :
     - ≥ 85% → PASS
     - 70%-84% → REVIEW_REQUIRED (escalade manuelle)
     - < 70% → FAIL (rejet automatique)
6. **Étape 5 — Détection de doublons** (< 2s) :
   - Recherche du visage dans la base de données biométrique existante
   - Si similarité > 90% avec un autre membre → alerte `kyc.duplicate.detected`
7. **Étape 6 — Screening AML** (< 3s) :
   - Vérification nom + date de naissance contre OFAC, ONU, UE, Interpol
   - Vérification PEP (Politically Exposed Persons)
   - Si match → REVIEW_REQUIRED avec détail du match
8. **Résultat global** :
   - Toutes les étapes passent → statut `VERIFIED`, événement `kyc.verified` émis
   - Au moins une étape en REVIEW → statut `REVIEW_REQUIRED`, événement `kyc.review.required` émis
   - Une étape critique échoue (face match < 70%, document expiré) → statut `REJECTED`, événement `kyc.rejected` émis
9. Temps total du pipeline < 10 secondes

### Notes techniques

- Le pipeline est orchestré via un workflow asynchrone (Step Functions ou Saga)
- Chaque étape est un worker indépendant avec circuit breaker vers le provider
- Les résultats intermédiaires sont stockés dans la base KYC pour audit
- Si le provider est indisponible → retry 3× avec backoff, puis escalade manuelle

---

## US-3.3 · Vérification manuelle escaladée

**En tant qu'** agent KYC,
**je veux** traiter les vérifications manuelles escaladées,
**afin de** statuer sur les cas que l'automatisation ne peut pas trancher.

**Points** : 8 · **Priorité** : Haute · **Sprint** : 4

### Critères d'acceptation détaillés

1. L'agent accède au tableau de bord des dossiers en `REVIEW_REQUIRED`, triés par ancienneté
2. Pour chaque dossier, l'agent voit :
   - Les documents soumis (zoom, rotation possible)
   - Le selfie
   - Le résultat de chaque étape automatique avec les scores
   - Les alertes éventuelles (doublon, AML match, qualité faible)
   - L'historique des soumissions précédentes du membre
3. L'agent peut :
   - Accepter avec annotation justificative (texte libre, min 10 caractères)
   - Rejeter avec catégorie de rejet (enum) + commentaire obligatoire
   - Demander des documents complémentaires (déclenche une notification au membre)
4. SLA : chaque dossier doit être traité dans les 24h ouvrées
5. L'action est journalisée : agentId, action, timestamp, commentaire

### Catégories de rejet

`DOCUMENT_ILLISIBLE`, `DOCUMENT_EXPIRE`, `DOCUMENT_FALSIFIE`, `FACE_MATCH_ECHOUE`, `DOUBLON_CONFIRME`, `AML_MATCH_CONFIRME`, `INFORMATION_INCOHERENTE`, `TYPE_DOCUMENT_NON_ACCEPTE`, `AUTRE`

---

## US-3.4 · Détection des doublons biométriques

**Points** : 8 · **Sprint** : 4

### Critères d'acceptation

1. À chaque soumission selfie, le système compare le visage avec tous les visages existants en base
2. Seuil de similarité : > 90% → alerte doublon
3. L'alerte contient : nouveau memberId, memberId existant, score de similarité, lien vers les deux dossiers
4. Le nouveau compte est bloqué (`PENDING_REVIEW`) jusqu'à résolution par un agent
5. L'événement `kyc.duplicate.detected` est émis vers le service Fraude

---

## US-3.5 · Screening AML / Sanctions

**Points** : 8 · **Sprint** : 4

### Critères d'acceptation

1. À chaque soumission KYC : vérification contre les listes OFAC, ONU, UE, Interpol, PEP
2. Également exécuté en batch quotidien sur tous les membres ACTIVE (nouvelles entrées dans les listes)
3. Si match trouvé : alerte avec détail (nom de la liste, date d'ajout, pays, raison)
4. Match automatique → REVIEW_REQUIRED (jamais rejet automatique — un humain doit confirmer)
5. Faux positifs gérés via une whitelist (memberId + liste + date → "confirmé non-match")

---

## US-3.6 · Gestion de l'expiration et du renouvellement

**Points** : 5 · **Sprint** : 5

### Critères d'acceptation

1. Job quotidien scannant les documents avec date d'expiration
2. J-30 : notification d'avertissement (email + in-app)
3. J-7 : rappel urgent (SMS + email)
4. J-0 : statut KYC → `EXPIRED`, kycLevel baisse d'un tier, notification
5. J+30 sans action : opérations financières suspendues
6. Resoumission : retour au flux US-3.1

---

# ÉPIQUE 4 — GESTION DES TONTINES (simple rotative)

---

## US-4.1 · Création d'une tontine

**Points** : 8 · **Sprint** : 3

### Critères d'acceptation détaillés

1. Le membre (KYC TIER_3, statut ACTIVE) accède au formulaire de création
2. Champs de configuration :
   - Nom (3-200 car, unique par créateur)
   - Montant de contribution (décimal > 0)
   - Devise (auto-remplie selon le pays, modifiable)
   - Fréquence (WEEKLY, BIWEEKLY, MONTHLY, BIMONTHLY)
   - Détail de la fréquence : jour de la semaine, semaine du mois
   - Nombre max de membres (3-50)
   - Date de début (≥ aujourd'hui + 7 jours)
   - Mode de tirage (RANDOM, FIXED_ORDER, PRIORITY_NEED)
   - Règles de pénalité (jours de grâce, % pénalité, nombre de défauts avant suspension)
   - Droit d'entrée (optionnel, ≥ 0)
   - Collation par tour (optionnel, ≥ 0)
3. Validation côté serveur de chaque paramètre
4. Tontine créée en statut `DRAFT`
5. Le créateur est inscrit automatiquement comme `TONTINE_ADMIN`
6. Événement `tontine.created` émis

---

## US-4.2 · Invitation de membres

**Points** : 5 · **Sprint** : 3

### Critères d'acceptation

1. L'admin invite par : email, téléphone, ou lien partageable (URL avec code unique)
2. Notification envoyée à l'invité avec : nom de la tontine, montant, fréquence, date de début
3. L'invité peut accepter ou refuser
4. Si accepté : vérification d'éligibilité (statut ACTIVE, KYC ≥ TIER_2, conformité OK, pays compatible)
5. Si éligible : inscription confirmée, événement `tontine.member.added` émis
6. Le lien d'invitation expire après 7 jours ou quand le nombre max de membres est atteint
7. L'admin peut révoquer une invitation non encore acceptée

---

## US-4.3 · Démarrage automatique

**Points** : 5 · **Sprint** : 4

### Critères d'acceptation

1. Job planifié vérifie quotidiennement les tontines en statut `READY` dont la date de début est atteinte
2. Conditions de démarrage vérifiées : ≥ 3 membres, tous KYC OK, tous droits d'entrée payés, tous statuts ACTIVE
3. Si OK : statut → `ACTIVE`, premier cycle créé en `IN_PROGRESS`
4. Tirage de l'ordre (si RANDOM) : algorithme Fisher-Yates, seed `crypto.randomBytes(32)`, résultat signé (hash SHA-256)
5. Bénéficiaire du cycle 1 déterminé
6. Événements `tontine.started` et `tontine.cycle.started` émis
7. Si conditions non remplies : notification à l'admin avec la liste des blocages

---

## US-4.4 · Génération des échéances de contribution

**Points** : 5 · **Sprint** : 4

### Critères d'acceptation

1. Au démarrage de chaque cycle : une échéance `Contribution` est créée pour chaque membre
2. Chaque échéance contient : memberId, cycleId, montant, date limite (calculée selon la fréquence), statut PENDING
3. La date limite respecte les variantes de fréquence (1er mercredi, 15 et 30, etc.)
4. Événement `tontine.contribution.due` émis pour chaque membre
5. Notification de rappel envoyée à chaque membre avec le montant et la date limite

---

## US-4.5 · Suivi des contributions et détection des retards

**Points** : 8 · **Sprint** : 5

### Critères d'acceptation

1. Tableau de bord temps réel par cycle : X/N membres ont payé, montant collecté, montant restant
2. Chaque paiement reçu met à jour la contribution : statut → `PAID`, `paid_date` enregistrée
3. Job planifié quotidien détecte les contributions `PENDING` dont la date limite + grâce est dépassée
4. Si retard détecté : statut → `LATE`, pénalité calculée (`contribution_amount × late_fee_percent / 100`), notification SMS urgente
5. Si 2+ défauts consécutifs (configurable) : membre suspendu de la tontine
6. L'admin peut voir le détail : qui a payé, qui est en retard, montants des pénalités

---

## US-4.6 · Détermination du bénéficiaire

**Points** : 8 · **Sprint** : 4

### Critères d'acceptation

1. Mode RANDOM : le bénéficiaire est celui tiré pour ce cycle (tiré au démarrage US-4.3)
2. Mode FIXED_ORDER : l'admin a défini l'ordre, le bénéficiaire est le Nème dans la liste
3. Mode PRIORITY_NEED : les membres soumettent une demande, l'admin ou un vote détermine le bénéficiaire
4. Le bénéficiaire est affiché à tous les membres au début du cycle
5. Vérification : le bénéficiaire n'a pas encore été bénéficiaire dans ce cycle global
6. Le résultat du tirage est horodaté et hashé pour preuve d'intégrité (non-répudiation)

---

## US-4.7 · Paiement au bénéficiaire

**Points** : 5 · **Sprint** : 5

### Critères d'acceptation

1. Vérification que toutes les contributions du cycle sont reçues (statut PAID ou PAID_LATE)
2. Calcul du montant total : somme des contributions − collation éventuelle
3. Création d'une transaction interne : crédit du wallet du bénéficiaire
4. Événement `tontine.payout.initiated` émis
5. Notification au bénéficiaire : "Vous avez reçu X [devise] de la tontine [nom]"
6. Notification à tous les membres : "Le cycle N est terminé, [prénom] a reçu le pot"
7. Si contributions incomplètes : selon la config → paiement partiel OU report du cycle

---

## US-4.8 · Passage au cycle suivant

**Points** : 3 · **Sprint** : 5

### Critères d'acceptation

1. Après paiement réussi : cycle actuel → `COMPLETED`
2. Si des cycles restent : nouveau cycle créé → `IN_PROGRESS`, bénéficiaire suivant déterminé
3. Événements `tontine.cycle.completed` et `tontine.cycle.started` émis
4. Si c'était le dernier cycle → déclenche la clôture (US-4.9)

---

## US-4.9 · Clôture de la tontine

**Points** : 5 · **Sprint** : 6

### Critères d'acceptation

1. Tous les cycles sont complétés (chaque membre a été bénéficiaire une fois)
2. Vérification : aucun paiement en attente, aucune pénalité impayée
3. Statut → `COMPLETED`
4. Rapport final généré automatiquement (PDF) avec : liste des cycles, bénéficiaires, montants, pénalités, historique
5. Événement `tontine.closed` émis
6. Données archivées, consultables pendant 5 ans minimum

---

## US-4.10 · Tableau de bord de la tontine

**Points** : 8 · **Sprint** : 5

### Critères d'acceptation

1. L'admin voit un dashboard par tontine avec :
   - Total collecté tous cycles confondus
   - Cycle actuel : progression (X/N payés), montant collecté, bénéficiaire
   - Historique des cycles : bénéficiaire, montant, date
   - Pénalités totales collectées
   - Membres en retard ou défaut
2. Le membre voit : son propre historique de contributions, les cycles où il a été/sera bénéficiaire, son solde de pénalités éventuelles
3. Rafraîchissement automatique des données (polling 30s ou WebSocket)

---

# ÉPIQUE 5 — PORTEFEUILLE ÉLECTRONIQUE

*Les stories US-5.1 à US-5.6 suivent les mêmes principes de détail que ci-dessus.*

---

## US-5.1 · Création automatique du wallet — Sprint 1

**Déclencheur** : événement `member.created`. Création ACID, solde 0, devise du pays, statut ACTIVE. Idempotent. Événement `wallet.created` émis.

## US-5.2 · Consultation solde et historique — Sprint 2

Dashboard membre : solde total, solde disponible, solde bloqué. Historique paginé par curseur avec filtres (type, date, contexte). Chaque mouvement : montant, type (crédit/débit/hold), date, contexte (nom tontine, type d'opération), solde après opération.

## US-5.3 · Crédit après paiement externe — Sprint 3

Consomme `payment.completed`. Vérifie wallet actif + devise. Opération ACID : balance += amount. Mouvement de type CREDIT créé. Événement `wallet.balance.updated` émis. Notification au membre.

## US-5.4 · Débit pour contribution tontine — Sprint 4

Consomme demande du service Tontines. Vérifie : wallet actif, solde disponible ≥ montant, pas de blocage fraude. Isolation SERIALIZABLE. Si insuffisant → erreur `INSUFFICIENT_FUNDS`. Événement `wallet.balance.updated` émis.

## US-5.5 · Blocage et déblocage de fonds — Sprint 4

Hold : `blocked_amount += holdAmount` si `balance - blocked_amount ≥ holdAmount`. Conversion en débit ou annulation selon le résultat du paiement. Événements `wallet.hold.created` / `wallet.hold.released` émis.

## US-5.6 · Transfert entre membres — Sprint 5

Transaction atomique : débit wallet A + crédit wallet B. Les deux wallets doivent être ACTIVE avec la même devise. Clé d'idempotence obligatoire. Journal d'audit avec les deux mouvements liés.

---

# ÉPIQUE 6 — TRANSACTIONS

## US-6.1 · Création de transaction — Sprint 3

Création avec UUID, clé d'idempotence, type, montant, devise, initiateur, bénéficiaire, contexte (tontineId ou walletId), métadonnées (IP, device, timestamp). Statut initial PENDING.

## US-6.2 · Validation de transaction — Sprint 4

Pipeline de validation : solde (→ Wallet), KYC (→ Membres), limites (→ Conformité), fraude (→ Fraude), cohérence données. Si tout OK → VALIDATED. Si échec → REJECTED avec règle et motif.

## US-6.3 · Exécution ACID — Sprint 4

Débit + crédit wallets dans une transaction PostgreSQL SERIALIZABLE. Statut → COMPLETED. Mouvements wallet créés. Événement `transaction.completed` émis.

## US-6.4 · Gestion des erreurs et compensation — Sprint 5

Si erreur post-débit (crédit échoué) → reverse transaction : recrédit du wallet source. Statut → REVERSED. Événement `transaction.reversed` émis. Notification aux services et à l'utilisateur.

## US-6.5 · Journal d'audit — Sprint 3

Chaque transaction génère un log immuable : txId, IP, device, User-Agent, timestamp, pays, action, résultat. Stockage dans table append-only. Conservation 7 ans.

## US-6.6 · Rapport de réconciliation — Sprint 6

Comparaison quotidienne : transactions internes vs paiements PSP vs mouvements wallet. Détection des écarts. Rapport CSV/PDF avec les lignes discordantes. Alerte si écart > seuil configurable.

---

# ÉPIQUE 7 — PAIEMENTS (PSP)

## US-7.1 · Dépôt Mobile Money — Sprint 3-4 (13 pts)

Intégration Flutterwave/Paystack. USSD push au numéro du membre. Callback traité (succès/échec). Wallet crédité via transaction interne. Retry 3× avec backoff. Fallback vers PSP alternatif.

## US-7.2 · Dépôt carte bancaire — Sprint 3-4 (13 pts)

Redirect vers page sécurisée PSP (3D Secure). Aucune donnée carte stockée (tokenisation). PCI-DSS respecté. Callback traité. Wallet crédité.

## US-7.3 · Retrait (cash-out) — Sprint 5 (8 pts)

Hold sur le wallet. Envoi au PSP. Callback : succès → hold converti en débit ; échec → hold annulé. Notification du résultat.

## US-7.4 · Gestion des statuts de paiement — Sprint 4 (8 pts)

Machine à états complète : PENDING → PROCESSING → COMPLETED/FAILED/EXPIRED. Retry avec backoff exponentiel. Circuit breaker par PSP. Polling si pas de callback après 5 min.

## US-7.5 · Gestion des remboursements — Sprint 6 (5 pts)

Initiation via PSP (refund API). Reversement interne (crédit wallet). Événement `payment.refunded` émis.

## US-7.6 · Réconciliation PSP — Sprint 6 (8 pts)

Job quotidien : téléchargement des relevés PSP via API, comparaison avec les paiements internes, rapport d'écarts, alerte si divergence.

---

# ÉPIQUE 8 — NOTIFICATIONS & COMMUNICATION

## US-8.1 · Génération de notifications — Sprint 3 (5 pts)

Écoute des événements métier. Transformation événement → alerte structurée (type, message brut, données contextuelles, priorité, canal recommandé). Événement `notification.created` émis.

## US-8.2 · Personnalisation des messages — Sprint 3 (5 pts)

Template par type d'événement × langue. Variables dynamiques : {nom}, {montant}, {date}, {tontine}. Format adapté au canal (SMS court, email HTML, push JSON). Respect des heures calmes.

## US-8.3 · Envoi SMS/Email avec résilience — Sprint 4 (8 pts)

File de messages (SQS/Kafka). Workers consommant par priorité. Intégration Twilio (SMS) + SendGrid (Email). Retry 3× avec backoff. Fallback canal alternatif. DLQ pour échecs définitifs. Delivery reports.

## US-8.4 · Rappels programmés — Sprint 5 (5 pts)

Planification de rappels (contribution due dans 3 jours, 1 jour, jour J). Respect du fuseau horaire du membre. Annulation si paiement reçu avant le rappel. Pas d'envoi en heures calmes (sauf urgence).

## US-8.5 · Préférences de notification — Sprint 4 (3 pts)

Interface dans le profil : canal préféré (SMS/email/push), heures calmes (début/fin), types activés/désactivés. Les notifications de sécurité ne sont jamais désactivables.

---

# ÉPIQUE 9 — CONFORMITÉ

## US-9.1 · Détection du pays — Sprint 2 (5 pts)

Déduction du pays via : préfixe téléphonique, géolocalisation IP, documents KYC, profil. Résolution des conflits (KYC > profil > téléphone > IP). Stockage dans le profil membre.

## US-9.2 · Validation de conformité des opérations — Sprint 3 (8 pts)

API synchrone `POST /compliance/validate`. Vérifie limites (jour/mois), restrictions pays, interdictions. Temps de réponse < 100 ms. Cache Redis des règles (TTL 5 min).

## US-9.3 · Mise à jour dynamique des règles — Sprint 5 (8 pts)

Interface admin pour CRUD sur le catalogue de règles par pays. Propagation via événement `compliance.rule.updated`. Prise d'effet immédiate sans redéploiement. Historique des modifications.

## US-9.4 · Détection et blocage des violations — Sprint 4 (5 pts)

Détection automatique : dépassement de limites, opérations interdites, changement suspect de pays. Actions : blocage de l'opération, suspension du membre, alerte au service Fraude. Journalisation complète.

---

# ÉPIQUE 10 — ADMINISTRATION

## US-10.1 · Validation des demandes d'accès admin — Sprint 2 (5 pts)

Super-admin voit la liste des demandes. Pour chaque demande : profil, tontine associée, documents éventuels. Accepter ou refuser avec motif. Notification au demandeur.

## US-10.2 · Configuration des comptes de tontine — Sprint 4 (8 pts)

Admin crée les comptes associés à sa tontine : compte principal (cotisation), compte solidarité, compte épargne, compte prêt. Chaque compte a : nom, type, règles de calcul (intérêts, conditions de sortie). En V1 : seul le compte principal est fonctionnel.

## US-10.3 · Messagerie ciblée — Sprint 5 (5 pts)

Admin envoie un message à tous les membres de sa tontine ou à un sous-ensemble (filtre par statut). Templates disponibles (rappel, annonce, information). Envoi via le service Communication. Historique des messages envoyés.

## US-10.4 · Génération de rapports financiers — Sprint 6 (8 pts)

Rapports disponibles : bilan par tour, bilan mensuel, bilan annuel, historique des contributions, historique des pénalités. Filtres : période, type de données. Export PDF et CSV. Données par tontine uniquement (isolation).

---

# RÉSUMÉ — PLANIFICATION PAR SPRINT

| Sprint | Durée | User Stories | Points |
|---|---|---|---|
| **Sprint 1** | 2 sem | US-1.1, US-1.2, US-1.4, US-2.1, US-2.5, US-5.1 | 26 |
| **Sprint 2** | 2 sem | US-1.3, US-1.5, US-2.2, US-2.3, US-2.4, US-2.6, US-9.1, US-10.1 | 30 |
| **Sprint 3** | 2 sem | US-3.1, US-4.1, US-4.2, US-5.3, US-6.1, US-6.5, US-7.1(début), US-7.2(début), US-8.1, US-8.2, US-9.2 | 53 |
| **Sprint 4** | 2 sem | US-1.6, US-3.2(début), US-4.3, US-4.6, US-5.4, US-5.5, US-6.2, US-6.3, US-7.1(fin), US-7.2(fin), US-7.4, US-8.3, US-8.5, US-9.4, US-10.2 | 72 |
| **Sprint 5** | 2 sem | US-3.2(fin), US-4.4, US-4.5, US-4.7, US-4.8, US-4.10, US-5.2, US-5.6, US-6.4, US-7.3, US-8.4, US-9.3, US-10.3 | 63 |
| **Sprint 6** | 2 sem | US-3.3, US-3.6, US-4.9, US-6.6, US-7.5, US-7.6, US-10.4 | 47 |
| **Sprint 7** | 2 sem | US-3.4, US-3.5, stabilisation, tests d'intégration | 21 |
| **Sprint 8** | 2 sem | Tests E2E, performance, sécurité, corrections, documentation | — |

**Total** : ~312 points · 8 sprints · 16 semaines
