# Modèle de sécurité

## 1. Authentification

| Élément           | Implémentation                                                                                                                                                                    | Référence                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Mots de passe     | bcrypt coût 12 (configurable ≥ 12), politique : ≥ 12 caractères, majuscule, minuscule, chiffre, symbole, pas dans la liste des mots de passe courants, différent des 5 derniers   | R-AUTH-02, US-1.5               |
| Access token      | JWT RS256, 15 min, claims `sub, role, tontineIds[], sid, iat, exp, jti`, `kid` dans l'en-tête, JWKS publié                                                                        | US-1.4, R-AUTH-LOGIN-05         |
| Refresh token     | Opaque UUID v4, 7 jours, stocké haché SHA-256, lié au device (UA + IP), **rotation à chaque usage**, détection de réutilisation (révocation de toute la famille)                  | US-1.4, R-AUTH-04               |
| Révocation        | Blacklist Redis `jti` avec TTL = durée restante ; vérification de session active (`sid`)                                                                                          | US-1.4                          |
| Sessions          | Max 5 actives ; au-delà, la plus ancienne est révoquée                                                                                                                            | R-AUTH-LOGIN-03                 |
| Verrouillage      | 5 échecs / 10 min → 15 min ; 15 échecs / 1 h → verrouillage jusqu'à action admin + notification                                                                                   | US-1.4                          |
| Liens / jetons    | UUID v4, stockés hachés SHA-256, usage unique, expiration (activation 48 h, reset 1 h)                                                                                            | US-1.1, US-1.5                  |
| OTP               | 6 chiffres, `crypto.randomInt`, haché bcrypt, 15 min, 3 tentatives puis blocage 15 min, max 3 renvois / h                                                                         | US-1.2                          |
| MFA               | TOTP RFC 6238 (`otpauth`, 30 s, 6 chiffres, secret 160 bits chiffré AES-256-GCM) ou OTP SMS ; 10 codes de récupération `XXXX-XXXX` hachés bcrypt ; obligatoire pour `SUPER_ADMIN` | US-1.6                          |
| Messages d'erreur | Génériques (pas de distinction identifiant / mot de passe ; mot de passe oublié et demande de compte ne révèlent pas l'existence d'un compte)                                     | R-AUTH-LOGIN-01, US-1.3, US-1.5 |

## 2. Autorisation

Double contrôle systématique :

1. **Rôle** (`@Roles(...)` + `RolesGuard`) : `SUPER_ADMIN`, `TONTINE_ADMIN`, `MEMBER`, `KYC_AGENT`, `COMPLIANCE_AGENT`.
2. **Propriété de la ressource** :
   - `/me/*` et `/members/{memberId}/*` : `memberId === token.sub` sauf rôle administrateur habilité ;
   - ressources de tontine : `TontineAccessService.assertAdmin(tontineId, userId)` ou `assertParticipant(...)` ;
   - listes financières : filtrage forcé par `token.sub` côté requête, jamais par un paramètre client ;
   - documents KYC : `KYC_AGENT`, `SUPER_ADMIN` (lecture journalisée) et le système uniquement ;
   - annuaire et historique des membres (`GET /members`, `/members/{id}/history`) : permission `platform.members.read` (`SUPER_ADMIN`, `KYC_AGENT`), coordonnées masquées dans les listes, lecture journalisée ;
   - dossiers de conformité, assignation et score de risque : `compliance.cases.manage` (`SUPER_ADMIN`, `COMPLIANCE_AGENT`) ; screening à la demande : `compliance.screening.run` (`KYC_AGENT`, `COMPLIANCE_AGENT`) ; correspondances AML : `kyc.aml.review` (idem) ; séparation des fonctions KYC / conformité (A-49) ;
   - rapports plateforme (`/reports/*`) : permission `platform.reports.view` (`SUPER_ADMIN`), agrégats sans donnée personnelle.

Tout refus produit un `audit_logs.result = DENIED` ; un compteur Redis déclenche une alerte si > 20 refus / 10 min pour un même utilisateur (US-2.5).

Matrice de référence : `packages/auth/src/rbac.ts` (source unique, testée).

## 3. Protection des données

- Données personnelles masquées dans les listes admin (`j***@email.com`, `+237 6** *** **45`, US-2.3).
- Aucune donnée sensible dans les SMS : pas de montant exact, pas de numéro de compte (R-NOT-02).
- Documents KYC chiffrés AES-256-GCM avant stockage, clé par environnement (`DOCUMENT_ENCRYPTION_KEY`), identifiants opaques, hors répertoires publics (R-KYC-05, A-17).
- Logs : redaction automatique (`password`, `token`, `otp`, `secret`, `authorization`, `cookie`, numéros complets).
- Aucune donnée de carte (R-PAY-06) : le simulateur carte renvoie une URL de redirection ; seul un jeton PSP opaque est conservé.

## 4. Intégrité financière

- Idempotence : en-tête `Idempotency-Key` obligatoire sur `POST` financiers ; stockage (portée, utilisateur, clé, empreinte de la requête) ; même clé + corps différent → 422 ; même clé en cours → 409 ; même clé terminée → réponse rejouée.
- Webhooks PSP : signature HMAC-SHA256 (`x-psp-signature`), horodatage ±5 min (`x-psp-timestamp`), non-répétition (unicité `provider + eventId`), idempotence métier (statut du paiement), vérification montant + devise.
- Concurrence : verrous ordonnés + `SERIALIZABLE` + CHECK SQL ; tests de débits concurrents.
- Tables append-only protégées par trigger (`audit_logs`, `trx_audit_logs`, `wal_movements`, `mbr_audit_logs`).

## 5. API Gateway (défense en profondeur)

Point d'entrée unique des clients (`apps/api-gateway`, :8080). Il ne remplace aucun contrôle des services, qui restent l'autorité (RBAC, propriété, révocation de session).

- JWT : signature RS256 vérifiée par le JWKS du service d'authentification, émetteur, expiration, claims obligatoires ; jeton invalide → 401 sans appeler le service.
- Règles de bord : `/api/v1/admin/**` et `/api/v1/reports/**` réservés à `SUPER_ADMIN` (configurable, `GATEWAY_EDGE_RULES`).
- En-têtes d'identité (`X-User-*`, `X-Session-Id`, `X-Forwarded-*`, `Forwarded`) fournis par le client supprimés ; `X-User-Id` / `X-User-Role` repositionnés après vérification, à titre informatif (les services revérifient le JWT).
- Adresse client : `X-Forwarded-For` n'est pris en compte que pour `GATEWAY_TRUST_PROXY_HOPS` proxys de confiance (0 si le gateway est en frontal) ; l'adresse résolue est transmise seule aux services (limites par IP inchangées).
- Chemins : uniquement `/api/v1/*` ; segments `.`/`..`, séparateurs encodés et caractères non réservés encodés refusés (contournement de préfixe).
- Rate limiting par IP (global et plus strict sur `/auth/*`), corps limité (`GATEWAY_MAX_BODY_BYTES`), délai et disjoncteur par service amont, CORS restreint à l'origine du web (la politique CORS des services est retirée), Helmet.
- Routes jamais exposées : `/api/v1/internal/**` (appels de service à service) et les webhooks PSP (`GATEWAY_BLOCKED_PREFIXES`).
- Production : les services ne doivent être joignables que par le gateway (réseau privé) ; limiteur partagé (Redis) si plusieurs instances.

### Payment Gateway et appels internes

Webhooks PSP reçus uniquement par `apps/payment-gateway` (:8090) : signature, horodatage, prestataire activé, taille, non-rejeu et idempotence (journal propre), refus d'un identifiant réutilisé avec un autre contenu, transmission unique (bail atomique). Appel au Payment Service signé par HMAC (`packages/auth/src/internal-signature.ts` : appelant autorisé, horodatage ± 60 s, comparaison à temps constant) ; tout refus est journalisé (`internal.request.rejected`). Détails : A-47.

### Suspension de compte

`PATCH /admin/users/:id/status` : révocation de toutes les sessions, refus du jeton en cours à la requête suivante (statut vérifié à chaque appel), interdit sur son propre compte et sur le dernier super-admin actif, motif audité (A-50).

## 6. Protections HTTP

Helmet (CSP, HSTS, frameguard, noSniff), CORS limité à `WEB_ORIGIN`, cookies `HttpOnly Secure SameSite=Strict`, rate limiting Redis (login 10/min/IP et 5/10 min/compte, demande de compte 5/h/IP, inscriptions 50/h/admin), taille de corps limitée, validation zod stricte (champs inconnus rejetés), ProblemDetails sans pile d'appels en production.

CSRF : le refresh token est en cookie `SameSite=Strict` ; toutes les autres routes utilisent l'en-tête `Authorization`, non envoyé automatiquement par le navigateur.

## 7. Secrets

- Aucun secret réel dans le dépôt ; `.env.example` ne contient que des valeurs factices marquées `dev-only`.
- Clés JWT de dev générées localement dans `.keys/` (ignoré).
- CI : `gitleaks` sur chaque push ; `pnpm audit --audit-level high`.

## 8. Menaces couvertes par les tests

| Menace                                     | Test                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Accès aux données d'un autre membre (IDOR) | `members.access.e2e-spec`, `wallets.access.e2e-spec`             |
| Admin d'une autre tontine                  | `tontines.authz.e2e-spec`                                        |
| Réutilisation de refresh token             | `auth.refresh-rotation.e2e-spec`                                 |
| Rejeu / double webhook                     | `payments.webhook.e2e-spec`                                      |
| Double débit concurrent                    | `wallets.concurrency.int-spec`                                   |
| Force brute login / OTP                    | `auth.lockout.e2e-spec`, `auth.otp.spec`                         |
| Énumération de comptes                     | `auth.forgot-password.e2e-spec`, `auth.request-account.e2e-spec` |
