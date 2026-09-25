# Référence des routes (contrat web ⇄ API)

Complément lisible de `docs/openapi.json` (généré par `pnpm --filter @tontine/api openapi`). Toutes les routes sont préfixées par `/api/v1` sauf mention contraire. `🔒` = jeton requis ; `💸` = en-tête `Idempotency-Key` obligatoire. Montants : `{ amount: "50000", amountMinor: "50000", currency: "XAF" }` (type `MoneyView`).

## Authentification (épique 1)

| Méthode       | Route                                   | Corps / réponse                                                                                                                                                                   |
| ------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST          | `/auth/login`                           | `{identifier, password}` → `{accessToken, expiresIn, tokenType, user:{id, role, mfaSetupRequired}}` + cookie `tm_rt` ; ou `{mfaRequired:true, challengeToken, mfaType:'TOTP'      | 'SMS', expiresIn}`                                                        |
| POST          | `/auth/login/mfa`                       | `{challengeToken, code}` (code TOTP/SMS 6 chiffres ou code de récupération `XXXX-XXXX`) → comme login + `recoveryCodesExhausted`                                                  |
| POST          | `/auth/refresh`                         | cookie `tm_rt` → `{accessToken, expiresIn}` (rotation)                                                                                                                            |
| POST 🔒       | `/auth/logout`                          | 204                                                                                                                                                                               |
| GET 🔒        | `/auth/me`                              | `{id, role, status, accessState, memberStatus, kycLevel, firstName, lastName, email, phone, language, mfa:{enabled,type,required,usedThisSession}, tontineIds, delegatedTontine}` |
| GET/DELETE 🔒 | `/auth/sessions`, `/auth/sessions/{id}` | sessions actives                                                                                                                                                                  |
| POST          | `/auth/request-account`                 | `{firstName, lastName, email, phone, preferredChannel:'SMS'                                                                                                                       | 'EMAIL', invitationCode?, tontineName?, captchaToken}`→ 202`{message}`    |
| POST          | `/auth/activate`                        | `{token}` **ou** `{identifier, otp}` + `password` → `{activated, userId}`                                                                                                         |
| POST          | `/auth/activation/resend`               | `{identifier}` → 202                                                                                                                                                              |
| POST          | `/auth/forgot-password`                 | `{identifier}` → 200 `{message}`                                                                                                                                                  |
| POST          | `/auth/reset-password`                  | `{token, newPassword}` → 204                                                                                                                                                      |
| GET 🔒        | `/auth/mfa`                             | `{enabled, type, recoveryCodesLeft, required, mustRegenerate}`                                                                                                                    |
| POST 🔒       | `/auth/mfa/enable`                      | `{type:'TOTP'                                                                                                                                                                     | 'SMS'}`→ TOTP`{otpauthUrl, qrCodeUrl (data URL), secret}`; SMS`{smsSent}` |
| POST 🔒       | `/auth/mfa/verify`                      | `{code}` → `{success, recoveryCodes[10]}` (affichés une seule fois)                                                                                                               |
| POST 🔒       | `/auth/mfa/disable`                     | `{password, code}` → 204                                                                                                                                                          |
| POST 🔒       | `/auth/mfa/recovery-codes`              | `{code}` → `{recoveryCodes}`                                                                                                                                                      |
| GET           | `/.well-known/jwks.json` (sans préfixe) | JWKS                                                                                                                                                                              |

Liens envoyés par email/SMS : `${APP_PUBLIC_URL}/activate/{token}`, `${APP_PUBLIC_URL}/reset-password/{token}`, `${APP_PUBLIC_URL}/invitations/{code}`.

## Administration des comptes

| Méthode | Route                                         | Rôle                               | Corps / réponse                                                                                                            |
| ------- | --------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| POST 🔒 | `/admin/tontine-admins`                       | SUPER_ADMIN                        | `{firstName, lastName, email, phone, country, language, tontineName}` → `{id, status, activation:{delivered[], failed[]}}` |
| GET 🔒  | `/access-requests?tontineId&status`           | SUPER_ADMIN ou admin de la tontine | `{data:[{id, status, createdAt, expiresAt, requestedTontineName, targetTontine, user:{…}}]}`                               |
| POST 🔒 | `/access-requests/{id}/decision`              | idem                               | `{decision:'APPROVE', tontineId?}` ou `{decision:'REJECT', reason}`                                                        |
| POST 🔒 | `/tontines/{tontineId}/members`               | admin de la tontine                | `{firstName, lastName, email?, phone?, preferredChannel, dateOfBirth?, address?, country?}` → `{id, status, channel}`      |
| GET 🔒  | `/admin/users?role&status&search`             | SUPER_ADMIN                        | liste des comptes                                                                                                          |
| POST 🔒 | `/admin/users/{id}/unlock`                    | SUPER_ADMIN                        | `{reason}` → 204                                                                                                           |
| POST 🔒 | `/admin/members/{id}/suspend` · `/reactivate` | SUPER_ADMIN                        | `{reason}`                                                                                                                 |

## Membres (épique 2)

| Méthode     | Route                                                                                                    | Corps / réponse                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET 🔒      | `/me/profile`                                                                                            | `MemberView {id, firstName, lastName, email, phone, country, countrySource, region, city, address, dateOfBirth, gender, language, timezone, status, kycLevel, complianceStatus, notificationPrefs, hasPhoto, version}` |
| PATCH 🔒    | `/me/profile`                                                                                            | champs partiels + `version` (409 si obsolète)                                                                                                                                                                          |
| PUT 🔒      | `/me/notification-preferences`                                                                           | `{preferredChannel, frequency, enabledTypes[], quietHours:{start,end}                                                                                                                                                  | null}` |
| POST/GET 🔒 | `/me/profile/photo`                                                                                      | multipart `file` (JPEG/PNG ≤ 5 Mo)                                                                                                                                                                                     |
| GET 🔒      | `/me/profile/history`                                                                                    | historique versionné                                                                                                                                                                                                   |
| GET 🔒      | `/members/{id}`                                                                                          | vue complète (soi), `LIMITED` (admin tontine partagée), `NAME_ONLY` (co-participant), 403 sinon                                                                                                                        |
| GET 🔒      | `/tontines/{id}/members?limit&cursor&status&kycLevel&registeredFrom&registeredTo&search&sort&membership` | `{data:[{id, fullName, email(masqué), phone(masqué), status, kycLevel, membershipStatus, membershipRole, registeredAt, lastActivityAt}], page, meta:{total, active, pending, suspended, summary}}`                     |

## Notifications (épique 8)

| GET 🔒  | `/me/notifications?unread&cursor`                           | `{data:[{id, category, priority, title, body, createdAt, readAt}], meta:{unread}}` |
| ------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| POST 🔒 | `/me/notifications/{id}/read`, `/me/notifications/read-all` | 204                                                                                |
| GET     | `/dev/messages?to=`                                         | **dev uniquement** : SMS/emails simulés (OTP, liens)                               |

## KYC (épique 3)

| Méthode     | Route                                               | Corps / réponse                                                                                                                                   |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET 🔒      | `/kyc/requirements`                                 | `{country, documentTypes[], singleSided[], maxFileBytes, minWidth, minHeight}`                                                                    |
| POST 🔒     | `/kyc/liveness`                                     | → `{livenessToken}` (session de liveness simulée, à appeler au moment de la capture caméra)                                                       |
| POST 🔒     | `/kyc/submit`                                       | multipart : `documentType`, `captureSource='CAMERA'`, `livenessToken`, fichiers `front`, `back?`, `selfie` → `{kycRequestId, status:'SUBMITTED'}` |
| POST 🔒     | `/kyc/tier3`                                        | multipart : `incomeSource`, `captureSource`, `livenessToken`, fichiers `proofOfAddress`, `selfie`                                                 |
| GET 🔒      | `/kyc/me`                                           | `{kycLevel, memberStatus, current:{id, status, documentType, submittedAt, rejectCategory?, rejectReason?}                                         | null, history[]}`           |
| GET 🔒      | `/kyc/reviews?status`                               | KYC_AGENT / SUPER_ADMIN : dossiers triés par ancienneté, avec `slaDueAt`                                                                          |
| GET 🔒      | `/kyc/requests/{id}`                                | dossier : documents (métadonnées), checks (étape, résultat, score), alertes, soumissions précédentes                                              |
| GET 🔒      | `/kyc/documents/{documentId}`                       | image déchiffrée (agents uniquement, accès journalisé)                                                                                            |
| POST 🔒     | `/kyc/requests/{id}/decision`                       | `{action:'APPROVE', annotation≥10}` · `{action:'REJECT', category, comment}` · `{action:'REQUEST_SUPPLEMENT', comment}`                           |
| GET/POST 🔒 | `/kyc/duplicates`, `/kyc/duplicates/{id}/resolve`   | `{resolution:'CONFIRMED'                                                                                                                          | 'DISMISSED', comment}`      |
| GET/POST 🔒 | `/kyc/aml-matches`, `/kyc/aml-matches/{id}/resolve` | `{resolution:'CONFIRMED_MATCH'                                                                                                                    | 'FALSE_POSITIVE', comment}` |

## Tontines (épique 4)

| Méthode     | Route                                                               | Corps / réponse                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST 🔒     | `/tontines`                                                         | `CreateTontineInput` (voir `packages/contracts/src/schemas/tontines.ts`) → `TontineView`                                                                                                                                                               |
| GET 🔒      | `/tontines`                                                         | tontines dont je suis membre ou admin : `{data:[TontineView & {myRole, myStatus}]}`                                                                                                                                                                    |
| GET 🔒      | `/tontines/{id}`                                                    | `TontineView {id, name, status, contribution:MoneyView, frequency, frequencyDetail, maxMembers, memberCount, startDate, drawMode, penaltyRules, entryFee, collation, incompletePolicy, currentCycleNumber, totalCycles, myRole, myStatus, version}`    |
| POST 🔒     | `/tontines/{id}/cancel`                                             | `{reason}` (admin, DRAFT/READY)                                                                                                                                                                                                                        |
| POST/GET 🔒 | `/tontines/{id}/invitations`                                        | `{channel:'EMAIL', email}` · `{channel:'PHONE', phone}` · `{channel:'LINK'}` → `{id, channel, status, expiresAt, url?}`                                                                                                                                |
| DELETE 🔒   | `/tontines/{id}/invitations/{invitationId}`                         | révocation                                                                                                                                                                                                                                             |
| GET 🔒      | `/me/invitations`                                                   | invitations reçues                                                                                                                                                                                                                                     |
| POST 🔒     | `/invitations/{id}/respond`                                         | `{accept}` → adhésion ou `{eligible:false, reasons[]}` (422)                                                                                                                                                                                           |
| GET/POST 🔒 | `/invitations/code/{code}` · `/invitations/code/{code}/accept`      | aperçu / acceptation d'un lien partageable                                                                                                                                                                                                             |
| PUT 🔒      | `/tontines/{id}/draw-order`                                         | `{memberIds[]}` (FIXED_ORDER, cycles futurs uniquement)                                                                                                                                                                                                |
| POST/GET 🔒 | `/tontines/{id}/priority-requests`                                  | `{reason}` (PRIORITY_NEED)                                                                                                                                                                                                                             |
| POST 🔒     | `/tontines/{id}/cycles/{cycleId}/beneficiary`                       | `{memberId}` (admin, PRIORITY_NEED)                                                                                                                                                                                                                    |
| GET 🔒      | `/tontines/{id}/participants`                                       | vue membre : `[{memberId, firstName, role, position, currentContributionStatus}]` (pas de montants individuels)                                                                                                                                        |
| GET 🔒      | `/tontines/{id}/cycles` · `/tontines/{id}/cycles/{cycleId}`         | cycles ; détail admin : contributions (membre, statut, montant, pénalité, payée le)                                                                                                                                                                    |
| GET 🔒      | `/tontines/{id}/dashboard`                                          | admin (US-4.10) : `{totalCollected, currentCycle:{number, beneficiary, paidCount, memberCount, collected, remaining, dueDate}, cycles[], penaltiesCollected, lateMembers[]}` ; membre : `{myContributions[], myBeneficiaryCycles[], myPenaltyBalance}` |
| POST 🔒💸   | `/tontines/{id}/contributions/{contributionId}/pay`                 | débit du wallet (+ pénalité due) → `{contribution, transactionId}`                                                                                                                                                                                     |
| POST 🔒💸   | `/tontines/{id}/entry-fee/pay`                                      | droit d'entrée                                                                                                                                                                                                                                         |
| POST 🔒     | `/tontines/{id}/cycles/{cycleId}/force-payout`                      | `{reason}` (admin, paiement partiel explicite)                                                                                                                                                                                                         |
| GET 🔒      | `/tontines/{id}/draw-proof`                                         | preuve du tirage (hash SHA-256, horodatage)                                                                                                                                                                                                            |
| POST 🔒     | `/admin/tontines/{id}/pause` · `/resume`                            | SUPER_ADMIN `{reason}`                                                                                                                                                                                                                                 |
| GET/POST 🔒 | `/tontines/{id}/accounts`                                           | US-10.2 `{name, type:'MAIN'                                                                                                                                                                                                                            | 'SOLIDARITY' | 'SAVINGS' | 'LOAN', rules}` |
| GET/POST 🔒 | `/tontines/{id}/messages`                                           | US-10.3 `{template, subject, body, filter:{memberStatuses?, contributionStatus?, memberIds?}}`                                                                                                                                                         |
| GET 🔒      | `/tontines/{id}/reports?kind&format&from&to&cycleNumber&year&month` | US-10.4 : `format=json                                                                                                                                                                                                                                 | csv          | pdf`      |

## Portefeuille, transactions, paiements (épiques 5-7)

| Méthode     | Route                                                                       | Corps / réponse                                                          |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET 🔒      | `/me/wallet`                                                                | `{id, currency, status, balance, available, blocked}`                    |
| GET 🔒      | `/me/wallet/movements?type&context&from&to&tontineId&cursor`                | historique avec `balanceAfter`                                           |
| POST 🔒💸   | `/me/wallet/deposits`                                                       | `{amount, currency, method:'MOBILE_MONEY'                                | 'CARD', phone?}`→`PaymentView {id, type, method, status, amount, provider, redirectUrl?, createdAt}` |
| POST 🔒💸   | `/me/wallet/withdrawals`                                                    | `{amount, currency, method:'MOBILE_MONEY', phone}` → `PaymentView`       |
| POST 🔒💸   | `/me/wallet/transfers`                                                      | `{toIdentifier                                                           | toMemberId, amount, currency, note?}`→`TransactionView`                                              |
| GET 🔒      | `/me/payments` · `/me/payments/{id}`                                        | paiements                                                                |
| GET 🔒      | `/me/transactions`                                                          | transactions (initiées ou reçues)                                        |
| POST        | `/payments/webhooks/{provider}`                                             | webhook PSP signé (HMAC `x-psp-signature`, `x-psp-timestamp`)            |
| GET/POST    | `/psp-sim/checkout/{reference}`                                             | **simulateur** : page carte 3-D Secure fictive, `POST {outcome:'SUCCESS' | 'FAILURE'}`                                                                                          |
| POST        | `/psp-sim/mobile-money/{reference}/confirm`                                 | **simulateur** : confirmation USSD `{outcome}`                           |
| POST 🔒     | `/admin/payments/{id}/refund`                                               | SUPER_ADMIN `{reason}`                                                   |
| GET 🔒      | `/admin/transactions?status&type` · POST `/admin/transactions/{id}/reverse` | SUPER_ADMIN                                                              |
| GET/POST 🔒 | `/admin/reconciliation` · `/admin/reconciliation/run`                       | `{kind:'INTERNAL'                                                        | 'PSP', date?}`; rapport`?format=csv`                                                                 |

## Conformité & fraude (épique 9, A-14)

| POST 🔒     | `/compliance/validate`                   | staff : `{operationType, memberId, amountMinor, currency, country?, context?}` → `{compliant, appliedRules[], violations[]}` |
| ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET/POST 🔒 | `/admin/compliance/rules`                | liste / création                                                                                                             |
| PATCH 🔒    | `/admin/compliance/rules/{code}`         | `{params?, active?, operationTypes?, description?, changeReason}`                                                            |
| GET 🔒      | `/admin/compliance/rules/{code}/history` | historique                                                                                                                   |
| GET 🔒      | `/admin/compliance/violations`           | violations                                                                                                                   |
| POST 🔒     | `/admin/fraud/flag`                      | `{memberId, reason}`                                                                                                         |

## Exploitation

| GET 🔒 | `/admin/jobs` · POST `/admin/jobs/{name}/run`            | tâches planifiées |
| ------ | -------------------------------------------------------- | ----------------- |
| GET 🔒 | `/admin/outbox/dead` · POST `/admin/outbox/{id}/requeue` | DLQ événements    |
| GET 🔒 | `/admin/audit-logs`                                      | journal d'audit   |
| GET    | `/health`, `/health/ready`, `/metrics` (sans préfixe)    | santé, Prometheus |
