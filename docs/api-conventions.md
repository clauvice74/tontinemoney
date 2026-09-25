# Conventions d'API

## Généralités
- Base : `/api/v1`. Versionnement par URL ; une rupture de contrat crée `/api/v2` pour les routes concernées.
- JSON UTF-8, champs `camelCase`, dates ISO 8601 UTC (`2026-09-24T12:00:00.000Z`), dates civiles `YYYY-MM-DD`.
- Documentation OpenAPI générée : `/api/docs` (Swagger UI) et `/api/docs-json`.
- Validation : schémas zod partagés (`packages/contracts`) ; champs inconnus rejetés.

## Authentification
- `Authorization: Bearer <accessToken>`.
- Refresh token : cookie `tm_rt` (HttpOnly, Secure, SameSite=Strict, Path=/api/v1/auth).

## En-têtes
| En-tête | Sens | Usage |
|---|---|---|
| `X-Correlation-Id` | requête ⇄ réponse | Généré s'il est absent ; propagé dans les logs et les événements |
| `Idempotency-Key` | requête | **Obligatoire** sur les POST financiers (dépôt, retrait, transfert, contribution, remboursement, paiement bénéficiaire) ; UUID ou chaîne 8–128 caractères |
| `Idempotent-Replayed: true` | réponse | Réponse rejouée depuis le stockage d'idempotence |

## Montants
```json
{ "amount": "50000", "currency": "XAF" }
```
Chaîne décimale en unités majeures, précision limitée à l'exposant de la devise (A-13). Les réponses incluent aussi `amountMinor` (chaîne) pour les clients qui calculent.

## Pagination par curseur
Requête : `?limit=20&cursor=<opaque>` (limit 1–100, défaut 20).
Réponse :
```json
{ "data": [...], "page": { "nextCursor": "opaque|null", "limit": 20 }, "meta": { } }
```
Le curseur encode `(clé de tri, id)` en base64url ; il est opaque pour le client.

## Erreurs — Problem Details (RFC 9457)
```json
{
  "type": "https://docs.tontinemoney.local/errors/insufficient-funds",
  "title": "Solde insuffisant",
  "status": 422,
  "code": "INSUFFICIENT_FUNDS",
  "detail": "Le solde disponible est insuffisant pour cette opération.",
  "correlationId": "…",
  "errors": [{ "path": "amount", "message": "…" }]
}
```

| Statut | Usage |
|---|---|
| 400 | Validation (`VALIDATION_FAILED`) |
| 401 | Non authentifié / identifiants incorrects (`INVALID_CREDENTIALS`) |
| 403 | Rôle ou propriété (`FORBIDDEN`) |
| 404 | Ressource inconnue **ou** non visible (pas de distinction pour éviter l'énumération hors périmètre) |
| 409 | Conflit : doublon, version obsolète (`VERSION_CONFLICT`), idempotence en cours |
| 410 | Jeton/OTP expiré (`TOKEN_EXPIRED`, `OTP_EXPIRED`) |
| 413 | Fichier trop volumineux |
| 422 | Règle métier (`INSUFFICIENT_FUNDS`, `CURRENCY_MISMATCH`, `INVALID_STATE_TRANSITION`, `COMPLIANCE_VIOLATION`…) |
| 423 | Compte verrouillé (`ACCOUNT_LOCKED`) |
| 429 | Limite de débit (`RATE_LIMITED`) + `Retry-After` |

Le catalogue complet des codes est dans `packages/contracts/src/errors.ts`.

## Concurrence optimiste
Les ressources versionnées (profil membre, tontine) exposent `version` ; les mises à jour exigent `version` dans le corps (ou `If-Match`) et renvoient 409 `VERSION_CONFLICT` si obsolète.

## Nommage des routes
- Ressources au pluriel, imbrication d'un niveau maximum : `/tontines/{tontineId}/members`.
- Actions métier non CRUD en sous-ressource verbale : `POST /tontines/{id}/start`, `POST /kyc/requests/{id}/decision`.
- Espace personnel : `/me`, `/me/wallet`, `/me/notifications`.
- Administration plateforme : `/admin/*` (SUPER_ADMIN).
