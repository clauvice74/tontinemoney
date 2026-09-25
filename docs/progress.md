# Suivi d'avancement

Légende : ⬜ à faire · 🟨 en cours · ✅ terminé (définition de terminé §19 respectée) · ⚠️ terminé avec limitation

## Journal de travail

- **Phase 0** — analyse des specs (59 stories), 28 hypothèses, architecture, modèle de domaine, sécurité, catalogue d'événements, conventions d'API, plan.
- **Phase 1** — monorepo pnpm/Turborepo ; Docker Compose ; Prisma 7 sans moteur natif + outil de migration hors ligne (schema engine WASM) ; migration initiale (CHECK financiers, triggers append-only, trigram) ; packages contracts/events/auth/config/platform (outbox, relais inprocess/Kafka, consommateurs idempotents, idempotence HTTP, audit, gardes, Problem Details, rate limiting, jobs, métriques) ; domaines auth, members, wallets (grand livre), notifications, ports tontines ; API NestJS ; seed de démonstration. Contrôles : format ✔ lint ✔ typecheck ✔ tests unitaires ✔ intégration 54 ✔.
- **Phase 2** — profil versionné, liste membres (curseur, filtres, trigram, masquage), décisions d'accès, transitions de statut, détection du pays, demande de compte, mot de passe oublié. 33 tests d'intégration supplémentaires (87 au total). Contrat d'API complet publié dans `docs/api-routes.md` (base du frontend).

## Stories

| Story   | Titre                                            | Statut | Fichiers | Tests | Critères satisfaits | Limitations |
| ------- | ------------------------------------------------ | ------ | -------- | ----- | ------------------- | ----------- |
| US-1.1  | Création d'un compte admin de tontine            | ⬜     |          |       |                     |             |
| US-1.2  | Inscription d'un membre par l'admin              | ⬜     |          |       |                     |             |
| US-1.3  | Demande de compte par un utilisateur invité      | ⬜     |          |       |                     |             |
| US-1.4  | Connexion et déconnexion sécurisée               | ⬜     |          |       |                     |             |
| US-1.5  | Réinitialisation de mot de passe                 | ⬜     |          |       |                     |             |
| US-1.6  | Activation du MFA                                | ⬜     |          |       |                     |             |
| US-2.1  | Création automatique du profil membre            | ⬜     |          |       |                     |             |
| US-2.2  | Complétion du profil membre                      | ⬜     |          |       |                     |             |
| US-2.3  | Liste des membres pour l'admin                   | ⬜     |          |       |                     |             |
| US-2.4  | Validation ou refus d'un membre                  | ⬜     |          |       |                     |             |
| US-2.5  | Isolation des données du membre                  | ⬜     |          |       |                     |             |
| US-2.6  | Gestion des transitions de statut                | ⬜     |          |       |                     |             |
| US-3.1  | Soumission de pièce d'identité et selfie         | ⬜     |          |       |                     |             |
| US-3.2  | Vérification automatique des documents           | ⬜     |          |       |                     |             |
| US-3.3  | Vérification manuelle escaladée                  | ⬜     |          |       |                     |             |
| US-3.4  | Détection des doublons biométriques              | ⬜     |          |       |                     |             |
| US-3.5  | Screening AML / Sanctions                        | ⬜     |          |       |                     |             |
| US-3.6  | Gestion de l'expiration et du renouvellement     | ⬜     |          |       |                     |             |
| US-4.1  | Création d'une tontine                           | ⬜     |          |       |                     |             |
| US-4.2  | Invitation de membres                            | ⬜     |          |       |                     |             |
| US-4.3  | Démarrage automatique                            | ⬜     |          |       |                     |             |
| US-4.4  | Génération des échéances de contribution         | ⬜     |          |       |                     |             |
| US-4.5  | Suivi des contributions et détection des retards | ⬜     |          |       |                     |             |
| US-4.6  | Détermination du bénéficiaire                    | ⬜     |          |       |                     |             |
| US-4.7  | Paiement au bénéficiaire                         | ⬜     |          |       |                     |             |
| US-4.8  | Passage au cycle suivant                         | ⬜     |          |       |                     |             |
| US-4.9  | Clôture de la tontine                            | ⬜     |          |       |                     |             |
| US-4.10 | Tableau de bord de la tontine                    | ⬜     |          |       |                     |             |
| US-5.1  | Création automatique du wallet                   | ⬜     |          |       |                     |             |
| US-5.2  | Consultation solde et historique                 | ⬜     |          |       |                     |             |
| US-5.3  | Crédit après paiement externe                    | ⬜     |          |       |                     |             |
| US-5.4  | Débit pour contribution tontine                  | ⬜     |          |       |                     |             |
| US-5.5  | Blocage et déblocage de fonds                    | ⬜     |          |       |                     |             |
| US-5.6  | Transfert entre membres                          | ⬜     |          |       |                     |             |
| US-6.1  | Création de transaction                          | ⬜     |          |       |                     |             |
| US-6.2  | Validation de transaction                        | ⬜     |          |       |                     |             |
| US-6.3  | Exécution ACID                                   | ⬜     |          |       |                     |             |
| US-6.4  | Gestion des erreurs et compensation              | ⬜     |          |       |                     |             |
| US-6.5  | Journal d'audit                                  | ⬜     |          |       |                     |             |
| US-6.6  | Rapport de réconciliation                        | ⬜     |          |       |                     |             |
| US-7.1  | Dépôt Mobile Money                               | ⬜     |          |       |                     |             |
| US-7.2  | Dépôt carte bancaire                             | ⬜     |          |       |                     |             |
| US-7.3  | Retrait (cash-out)                               | ⬜     |          |       |                     |             |
| US-7.4  | Gestion des statuts de paiement                  | ⬜     |          |       |                     |             |
| US-7.5  | Gestion des remboursements                       | ⬜     |          |       |                     |             |
| US-7.6  | Réconciliation PSP                               | ⬜     |          |       |                     |             |
| US-8.1  | Génération de notifications                      | ⬜     |          |       |                     |             |
| US-8.2  | Personnalisation des messages                    | ⬜     |          |       |                     |             |
| US-8.3  | Envoi SMS/Email avec résilience                  | ⬜     |          |       |                     |             |
| US-8.4  | Rappels programmés                               | ⬜     |          |       |                     |             |
| US-8.5  | Préférences de notification                      | ⬜     |          |       |                     |             |
| US-9.1  | Détection du pays                                | ⬜     |          |       |                     |             |
| US-9.2  | Validation de conformité des opérations          | ⬜     |          |       |                     |             |
| US-9.3  | Mise à jour dynamique des règles                 | ⬜     |          |       |                     |             |
| US-9.4  | Détection et blocage des violations              | ⬜     |          |       |                     |             |
| US-10.1 | Validation des demandes d'accès admin            | ✅ | services/auth/src/admin.controller.ts, registration.service.ts | phase2.e2e-spec.ts (US-10.1 ×3) | Liste, profil, tontine associée, accepter / refuser avec motif, notification | Documents joints : non prévus en V1 |
| US-10.2 | Configuration des comptes de tontine             | ⬜     |          |       |                     |             |
| US-10.3 | Messagerie ciblée                                | ⬜     |          |       |                     |             |
| US-10.4 | Génération de rapports financiers                | ⬜     |          |       |                     |             |
