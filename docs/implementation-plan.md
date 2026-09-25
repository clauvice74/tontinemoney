# Plan d'implémentation

Ordre imposé par le prompt §18. Chaque story est transformée en tâches **vérifiables** (V = preuve attendue : test automatisé, endpoint, écran). Les références de tests renvoient aux fichiers `*.spec.ts` (unitaires) et `*.e2e-spec.ts` (API + base de données).

## Phase 0 — Cadrage
| Tâche | Vérification |
|---|---|
| Analyse des specs, incohérences | `docs/specification-analysis.md` |
| Hypothèses | `docs/assumptions.md` |
| Architecture, modèle, sécurité, événements, conventions | `docs/*.md` |
| Plan + suivi | ce fichier, `docs/progress.md`, `CLAUDE.md` |

## Phase 1 — Socle
| Tâche | Vérification |
|---|---|
| Monorepo pnpm + Turborepo, tsconfig strict, ESLint, Prettier | `pnpm lint`, `pnpm typecheck` |
| Docker Compose (Postgres, Redis, Redpanda, MinIO, Mailpit, Prometheus, Grafana, OTel) | `docker compose config` |
| Prisma schema + migrations SQL (CHECK, triggers append-only, trigram) | `pnpm db:migrate` sur base vide |
| `packages/contracts` : argent, pays, erreurs, schémas | tests unitaires money/country/masking |
| `packages/events` : enveloppe + catalogue zod | tests de validation de payload |
| `packages/auth` : bcrypt, SHA-256, OTP, TOTP, JWT RS256, RBAC | tests unitaires |
| `packages/platform` : outbox, dispatcher, idempotence, audit, corrélation, gardes, ProblemDetails, KV, horloge | tests unitaires + intégration outbox |
| **US-1.1** création admin tontine | `POST /admin/tontine-admins` ; tests : nominal, 409 email, 400 E.164, 400 champs, SMS KO → email seul + alerte |
| **US-1.2** inscription membre par admin | `POST /tontines/{id}/members` ; tests nominal email/SMS, 409, 403, 400, OTP expiré 410, 3 échecs → blocage |
| **US-1.4** login/logout/refresh | tests nominal, 401 générique, 423 verrouillage, rotation + réutilisation, logout blacklist, 5 sessions max, nouveau device |
| **US-2.1** profil auto (consumer `user.registered`) | tests +237→CM, +1→CA, doublon ignoré, sans téléphone |
| **US-2.5** isolation | tests IDOR 403 sur toutes les routes `/members/{id}` |
| **US-5.1** wallet auto (consumer `member.created`) | test idempotence, devise du pays |

## Phase 2 — Profil & accès
| Story | Vérification |
|---|---|
| US-2.2 complétion profil | version 409, nom post-KYC 403, photo 413, transition KYC_REQUIRED, delta `member.updated` |
| US-2.3 liste membres admin | pagination curseur, filtres, recherche, masquage, compteurs, isolation tontine |
| US-2.4 validation/refus | motif obligatoire, 403 autre tontine, audit |
| US-2.6 transitions | matrice complète en test unitaire table-driven |
| US-9.1 détection pays | priorité KYC > profil > téléphone > IP |
| US-1.3 demande de compte | message générique, captcha, 3 demandes max, expiration 30 j |
| US-1.5 mot de passe oublié | message générique, token 1 h usage unique, 5 derniers, sessions fermées |
| US-10.1 validation demandes | liste, accepter/refuser, notification |

## Phase 3 — KYC, tontines, ledger, notifications
| Story | Vérification |
|---|---|
| US-3.1 soumission KYC | types par pays, contraintes fichier, une demande ouverte, chiffrement, `kyc.submitted` |
| US-3.2 pipeline auto | 6 étapes simulées, seuils 85/70, doublon 90, AML → REVIEW, expiration → REJECTED |
| US-4.1 création tontine | validations, TIER_3, DRAFT, créateur admin |
| US-4.2 invitations | email/téléphone/lien, acceptation avec éligibilité, révocation, expiration 7 j, max membres, READY |
| US-6.1 transactions | idempotence, métadonnées |
| US-6.5 journal d'audit | append-only (trigger testé) |
| US-8.1 / US-8.2 notifications | mapping événement → notification, templates fr/en, variables, heures calmes |
| US-9.2 validation conformité | limites jour/mois, restrictions pays, cache TTL 5 min |
| US-1.6 MFA | TOTP + SMS, codes de récupération, désactivation |

## Phase 4 — Cycles & paiements
| Story | Vérification |
|---|---|
| US-4.3 démarrage | conditions, Fisher-Yates + preuve SHA-256, blocages notifiés |
| US-4.4 échéances | calcul des dates par fréquence (tests calendrier) |
| US-4.6 bénéficiaire | 3 modes, unicité, preuve |
| US-5.3/5.4/5.5 crédit/débit/hold | SERIALIZABLE, INSUFFICIENT_FUNDS, concurrence, TTL hold |
| US-6.2 / US-6.3 validation + exécution | pipeline de validation, ACID |
| US-7.1 / US-7.2 dépôts simulés | mobile money, carte (redirect), webhook signé, retry, fallback |
| US-7.4 statuts paiement | machine à états, polling 5 min, expiration 15 min, circuit breaker |
| US-8.3 résilience | retry ×3, fallback canal, DLQ |
| US-8.5 préférences | sécurité non désactivable |
| US-9.4 violations | blocage, suspension, alerte |
| US-10.2 comptes de tontine | 4 types, seul MAIN fonctionnel |

## Phase 5 — Retards & paiements aux bénéficiaires
| Story | Vérification |
|---|---|
| US-4.5 retards | LATE + pénalité, DEFAULTED, suspension après N |
| US-4.7 paiement bénéficiaire | total − collation, POSTPONE / PARTIAL |
| US-4.8 cycle suivant | enchaînement + clôture déclenchée |
| US-4.10 tableau de bord | vues admin/membre, polling 30 s |
| US-5.2 historique wallet | filtres, curseur, solde après |
| US-5.6 transfert | atomique, devise, idempotence, verrou ordonné |
| US-6.4 compensation | REVERSED, recrédit |
| US-7.3 retrait | hold → capture / release |
| US-8.4 rappels | J-3, J-1, J, fuseau, annulation si payé |
| US-9.3 règles dynamiques | CRUD, historique, propagation cache |
| US-10.3 messagerie ciblée | filtres, templates, historique |

## Phase 6 — Clôture & durcissement
| Story | Vérification |
|---|---|
| US-3.3 revue manuelle | file triée, accepter/rejeter/compléments, SLA |
| US-3.4 doublons biométriques | blocage PENDING_REVIEW, alerte |
| US-3.5 AML | batch quotidien, whitelist |
| US-3.6 expiration KYC | J-30, J-7, J-0, J+30 |
| US-4.9 clôture | vérifications, rapport PDF, archivage |
| US-6.6 / US-7.6 réconciliation | écarts internes et PSP, CSV, alerte seuil |
| US-7.5 remboursement | refund PSP + reversement |
| US-10.4 rapports | PDF/CSV, filtres, isolation |
| E2E Playwright | parcours inscription → KYC → tontine → cycle → payout |
| Sécurité | revue des gardes, en-têtes, audit dépendances, gitleaks |
