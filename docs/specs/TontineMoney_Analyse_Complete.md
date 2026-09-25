# TontineMoney — Analyse Complète du Projet

## Document de spécifications fonctionnelles, techniques et découpage en récits de développement

---

# PARTIE 1 — ANALYSE DES EXIGENCES

## 1.1 Synthèse du besoin

TontineMoney (ou Cigale) est une plateforme fintech visant à numériser et moderniser la gestion des tontines — systèmes d'épargne communautaire très répandus dans les régions à faible bancarisation. La plateforme doit couvrir le cycle complet : inscription des membres, gestion des contributions, rotation des bénéficiaires, paiements sécurisés, conformité réglementaire multi-pays, et reporting financier.

## 1.2 Parties prenantes identifiées

| Partie prenante | Rôle | Besoin principal |
|---|---|---|
| Super-administrateur plateforme | Gère les accès globaux, valide les admins de tontine | Contrôle total, audit, conformité |
| Administrateur de tontine | Configure et gère une tontine spécifique | Outils de gestion membres, comptes, cycles |
| Membre / Participant | Contribue, reçoit des fonds, consulte ses comptes | Visibilité en temps réel, paiement simple |
| Régulateur / Auditeur | Vérifie la conformité | Rapports AML/KYC, journaux d'audit |
| PSP (Prestataires de paiement) | Traite les flux financiers | API fiables, réconciliation |

## 1.3 Périmètre fonctionnel — Matrice des modules

| # | Module / Service | Priorité | Itération |
|---|---|---|---|
| M1 | Authentification & Accès | Critique | 1 |
| M2 | Gestion des Membres | Critique | 1 |
| M3 | Service KYC | Critique | 1 |
| M4 | Gestion des Tontines (simple/rotative) | Critique | 1 |
| M5 | Portefeuille Électronique (Wallet) | Critique | 1 |
| M6 | Gestion des Transactions | Critique | 1 |
| M7 | Gestion des Paiements (PSP) | Critique | 1 |
| M8 | Alertes & Notifications | Haute | 1 |
| M9 | Communication (SMS/Email broker) | Haute | 1 |
| M10 | Conformité (région/pays/langue) | Haute | 1 |
| M11 | Administration plateforme | Haute | 1 |
| M12 | Rapports & Reporting | Moyenne | 2 |
| M13 | Traduction Automatique | Moyenne | 2 |
| M14 | Gestion des Comptes (solidarité, épargne, prêt) | Moyenne | 2 |
| M15 | Calcul (intérêts, pénalités, amendes) | Moyenne | 2 |
| M16 | Tontine financière avec caisse de prêts | Basse | 3 |
| M17 | Tontine financière avec enchères | Basse | 3 |
| M18 | Vente de parts | Basse | 3 |
| M19 | Tontine immobilière | Basse | 4+ |

## 1.4 Exigences non fonctionnelles consolidées

| Exigence | Cible | Justification |
|---|---|---|
| Disponibilité | 99,9 % | Service financier critique |
| Temps de réponse — lecture profil | < 150 ms | UX mobile |
| Temps de réponse — transaction interne | < 200 ms | Flux financier |
| Temps de réponse — initiation paiement | < 500 ms | Dépend du PSP |
| Temps de réponse — KYC automatique | < 5 s | OCR + face match |
| Temps de réponse — conformité | < 100 ms | Validation en ligne |
| Cohérence des données | ACID (PostgreSQL) | Intégrité financière |
| Scalabilité | Millions de profils/transactions | Croissance Afrique |
| Sécurité | Chiffrement transit + repos, PCI-DSS, MFA | Fintech réglementée |
| Traçabilité | Audit complet sur toute opération | Conformité AML |
| Multi-plateforme | Mobile, Tablette, Bureau | Accessibilité |

## 1.5 Contraintes identifiées

**Techniques** : architecture microservices imposée, PostgreSQL comme SGBD principal, Redis en cache, déploiement sur cloud (AWS/Azure/Jelastic), bus d'événements asynchrone.

**Réglementaires** : conformité KYC/AML variable selon pays africains ciblés, listes de sanctions (OFAC, Interpol), tontines potentiellement interdites dans certaines juridictions.

**Métier** : les règles varient considérablement d'un type de tontine à un autre (simple, financière, enchères, immobilière), nécessitant un moteur de règles flexible.

## 1.6 Risques majeurs

| Risque | Impact | Mitigation |
|---|---|---|
| Complexité des types de tontines | Explosion du périmètre | Démarrer par la tontine simple, moteur de règles extensible |
| Intégration PSP multi-pays | Délais, coûts | Pattern adaptateur avec fallback entre PSP |
| Conformité multi-juridictions | Blocage légal | Service conformité dynamique, catalogue de règles par pays |
| Adoption utilisateurs | Faible traction | UX mobile-first, onboarding simplifié |
| Fraude et doubles comptes | Perte financière | KYC biométrique, détection de doublons, scoring fraude |

---

# PARTIE 2 — SPÉCIFICATIONS FONCTIONNELLES

## 2.1 Service Authentification (M1)

**Objectif** : Sécuriser l'accès à la plateforme avec plusieurs modes d'inscription.

**Flux principaux** :

- **Inscription par admin** : L'admin enregistre un membre → le système envoie un lien/code OTP → le membre complète son inscription.
- **Inscription invité** : L'utilisateur se crée un compte → l'admin reçoit et valide la demande → notification envoyée au membre.
- **Connexion/Déconnexion** : Authentification par email/téléphone + mot de passe, gestion de sessions JWT.
- **MFA optionnel** : Deuxième facteur par SMS ou application authenticator.

**Règles métier** : Un utilisateur ne peut accéder aux fonctionnalités financières qu'après validation de son inscription par un admin et passage du KYC.

**Événements** : `user.registered`, `user.login`, `user.logout`, `user.password.reset`

## 2.2 Service Gestion des Membres (M2)

**Objectif** : Source de vérité pour l'identité fonctionnelle de chaque utilisateur.

**Entité Membre** : identifiant unique, nom, prénom, courriel, téléphone, pays, région, langue, statut (Pending → Active → Suspended), préférences (notifications, fuseau, confidentialité).

**Flux principaux** :

- Création automatique du profil à l'inscription
- Mise à jour du profil par le membre ou l'admin
- Transitions de statut pilotées par KYC, Conformité et Fraude
- Validation d'éligibilité pour rejoindre une tontine
- Gestion des invitations, départs et exclusions

**Contrainte** : Un membre ne peut pas se désinscrire lui-même d'une tontine. Seul l'admin de la tontine peut retirer un membre.

## 2.3 Service KYC (M3)

**Objectif** : Vérifier l'identité, évaluer le risque, assurer la conformité réglementaire.

**Niveaux KYC** :

| Niveau | Documents requis | Droits accordés |
|---|---|---|
| Tier 1 | Nom, téléphone, email | Consultation uniquement |
| Tier 2 | Pièce d'identité + selfie | Participation tontines, paiements limités |
| Tier 3 | Justificatif domicile + vérification vidéo | Paiements illimités, création de tontines |

**Processus** : Collecte → Vérification automatique (OCR, face match, détection falsification, détection doublons) → Vérification manuelle si échec auto → Attribution du statut KYC → Notification aux services dépendants.

**Statuts** : Pending → Submitted → Verified | Rejected | Review Required

**Cycle de vie** : Expiration des documents → Renouvellement → Re-vérification périodique → Suspension automatique si incohérence.

## 2.4 Service Gestion des Tontines (M4)

**Objectif** : Piloter l'ensemble du cycle de vie d'une tontine, de la création à la clôture.

**Paramètres de configuration** :

- Type de tontine (simple rotative en V1)
- Montant de contribution
- Fréquence (mensuelle, bimensuelle, aux 2 semaines — avec variantes : 1er mercredi, 2e jeudi, fin de mois, etc.)
- Nombre de membres
- Date de début
- Règles de tirage (aléatoire, ordre fixe, priorité besoin)
- Pénalités pour retards

**Cycle (tour)** :

1. Déclenchement automatique à la date prévue
2. Génération des échéances de contribution pour chaque membre
3. Suivi des paiements (via Service Transactions/Paiements)
4. Détection des retards → application des pénalités ou suspension
5. Vérification que toutes les contributions sont reçues
6. Détermination du bénéficiaire (tirage ou ordre)
7. Déclenchement du paiement au bénéficiaire
8. Passage au cycle suivant

**Règles métier critiques** :

- Démarrage uniquement si tous les membres sont KYC vérifiés
- Un bénéficiaire ne peut être sélectionné deux fois dans le même cycle global
- Contribution manquante peut bloquer le cycle selon les règles définies
- Suspension automatique en cas de fraude détectée
- Nouveaux membres possibles avant que tous les anciens aient été bénéficiaires (avec rattrapage des contributions)

**Comptes associés** (V2) : Compte principal (cotisation), Compte solidarité, Compte épargne, Compte prêt.

## 2.5 Service Portefeuille Électronique (M5)

**Objectif** : Gérer les soldes internes, mouvements, blocages de fonds.

**Opérations** : Crédit (paiement externe réussi, transfert interne, gain tontine, remboursement), Débit (contribution tontine, retrait PSP, transfert membre, pénalité), Blocage/déblocage (contribution en attente, paiement en cours).

**Statuts wallet** : Active, Suspended, Locked, Closed

**Règles** : ACID obligatoire, solde ne peut jamais devenir négatif, fonds bloqués exclus du solde disponible.

## 2.6 Service Transactions (M6)

**Objectif** : Orchestrer les flux financiers internes, garantir la cohérence.

**Processus** : Initiation → Validation (solde, KYC, limites, conformité, scoring fraude) → Exécution (débit/crédit wallet, ACID) → Suivi du statut → Réconciliation

**Statuts** : Pending → Processing → Completed | Failed | Rejected | Reversed | Refunded

**Compensation** : Rollback automatique en cas d'erreur, reverse transaction, notification aux services concernés.

## 2.7 Service Paiements (M7)

**Objectif** : Passerelle entre l'argent réel et l'écosystème interne via les PSP.

**PSP supportés** : Mobile Money (M-Pesa, Orange Money, MTN), Cartes bancaires (Visa, Mastercard), Banques locales (virements), Fournisseurs régionaux.

**Processus** : Réception demande → Validation (KYC, conformité, fraude, solde) → Envoi requête PSP → Traitement callback → Mise à jour statut → Actions internes (wallet, transactions)

**Résilience** : Retry automatique, fallback vers PSP alternatif, DLQ pour erreurs critiques.

## 2.8 Service Alertes & Notifications (M8)

**Objectif** : Orchestrer la diffusion de toutes les notifications.

**Canaux** : SMS, Email, Push, In-app, Webhooks

**Types** : Info, Succès, Erreur, Urgence — avec priorité, personnalisation linguistique, respect du fuseau horaire.

**Planification** : Rappels de contribution, rappels KYC, alertes périodiques (solde, rapports).

## 2.9 Service Communication — Broker (M9)

**Objectif** : Acheminer les messages vers les fournisseurs externes (Twilio, SendGrid, AWS SES/SNS).

**Fonctions** : File d'attente (SQS/Kafka/RabbitMQ), formatage par canal, routage intelligent par pays/coût/disponibilité, delivery reports, gestion des quotas anti-spam.

## 2.10 Service Conformité (M10)

**Objectif** : Appliquer les règles réglementaires par pays/région/langue de manière dynamique.

**Catalogue de règles** : Limites de transaction, limites de portefeuille, restrictions sur les tontines, obligations KYC/AML, restrictions de paiements sortants, interdictions légales.

**Détection** : Violations de limites, opérations interdites, incohérences pays/KYC, tentatives de contournement.

## 2.11 Service Rapports (M12)

**Types** : Financiers (volumes, contributions, réconciliation), Opérationnels (activité tontines, participation), Réglementaires (KYC, AML, fraude), Analytiques (comportement, tendances).

**Distribution** : Programmés ou à la demande, export PDF/CSV/JSON, stockage sécurisé S3.

## 2.12 Service Traduction (M13)

**Objectif** : Traduction automatique contextuelle avec glossaire métier centralisé, cache, et conformité linguistique par pays.

---

# PARTIE 3 — DÉCOUPAGE EN RÉCITS DE DÉVELOPPEMENT (USER STORIES)

## Itération 1 — MVP (Station bureau)

### Épique 1 : Authentification & Accès

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-1.1 | En tant qu'admin plateforme, je veux pouvoir créer un compte admin de tontine afin de lui donner accès | Le compte est créé, un email/SMS est envoyé avec lien d'activation | 5 |
| US-1.2 | En tant qu'admin tontine, je veux inscrire un membre avec ses informations de base afin qu'il rejoigne ma tontine | Le profil est créé en statut Pending, un lien/OTP est envoyé au membre | 5 |
| US-1.3 | En tant qu'utilisateur invité, je veux pouvoir demander la création d'un compte afin de rejoindre une tontine | La demande est soumise à l'admin pour validation | 3 |
| US-1.4 | En tant qu'utilisateur, je veux me connecter/déconnecter de manière sécurisée | JWT généré, session gérée, refresh token | 5 |
| US-1.5 | En tant qu'utilisateur, je veux réinitialiser mon mot de passe | Email/SMS avec lien de réinitialisation, expiration du lien | 3 |
| US-1.6 | En tant qu'utilisateur, je veux activer le MFA pour sécuriser mon compte | Configuration TOTP ou SMS, validation au login | 5 |

### Épique 2 : Gestion des Membres

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-2.1 | En tant que système, je crée un profil membre automatiquement à l'inscription | Profil créé avec ID unique, statut Pending, champs obligatoires initialisés | 3 |
| US-2.2 | En tant que membre, je veux compléter mon profil (téléphone, pays, langue) | Profil mis à jour, événement member.updated émis | 3 |
| US-2.3 | En tant qu'admin tontine, je veux voir la liste des membres et leur statut | Liste paginée, filtrable par statut, recherche par nom/email | 5 |
| US-2.4 | En tant qu'admin tontine, je veux valider ou refuser un membre | Transition de statut, notification au membre | 3 |
| US-2.5 | En tant que membre, je veux voir uniquement mes propres activités | Isolation des données, contrôle d'accès strict | 5 |
| US-2.6 | En tant que système, je gère les transitions de statut (Active, Suspended, KYC Required) | Transitions déclenchées par événements KYC/Conformité/Fraude | 5 |

### Épique 3 : KYC

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-3.1 | En tant que membre, je veux soumettre ma pièce d'identité et un selfie | Upload sécurisé, statut passe à Submitted | 5 |
| US-3.2 | En tant que système, je vérifie automatiquement les documents (OCR, face match) | Traitement < 5s, détection falsification, résultat Verified ou Review Required | 13 |
| US-3.3 | En tant qu'agent, je veux traiter les vérifications manuelles escaladées | Interface de review, annotation, acceptation/rejet avec motif | 8 |
| US-3.4 | En tant que système, je détecte les doublons (même personne, comptes multiples) | Comparaison biométrique, alerte si doublon détecté | 8 |
| US-3.5 | En tant que système, je vérifie les listes AML/sanctions | Intégration OFAC/Interpol, blocage si match | 8 |
| US-3.6 | En tant que système, je gère l'expiration et le renouvellement des documents | Notification avant expiration, suspension si non renouvelé | 5 |

### Épique 4 : Gestion des Tontines (simple rotative)

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-4.1 | En tant qu'admin tontine, je veux créer une tontine avec ses paramètres | Formulaire de configuration, validation des paramètres, statut Draft | 8 |
| US-4.2 | En tant qu'admin, je veux inviter des membres à ma tontine | Invitations envoyées, acceptation/refus, vérification KYC | 5 |
| US-4.3 | En tant que système, je démarre automatiquement la tontine à la date prévue | Démarrage si tous membres KYC vérifiés et conditions remplies | 5 |
| US-4.4 | En tant que système, je génère les échéances de contribution pour chaque cycle | Échéances créées selon fréquence, notifications envoyées | 5 |
| US-4.5 | En tant que système, je suis les contributions et détecte les retards | Suivi temps réel, alertes retard, application pénalités | 8 |
| US-4.6 | En tant que système, je détermine le bénéficiaire du cycle (tirage aléatoire ou ordre fixe) | Algorithme de tirage, impossibilité de doublon, traçabilité | 8 |
| US-4.7 | En tant que système, je déclenche le paiement au bénéficiaire | Vérification contributions complètes, déclenchement paiement, notification | 5 |
| US-4.8 | En tant que système, je passe automatiquement au cycle suivant | Transition de cycle, mise à jour des statuts | 3 |
| US-4.9 | En tant que système, je clôture la tontine quand tous les cycles sont complétés | Archivage, rapport final généré | 5 |
| US-4.10 | En tant qu'admin, je veux visualiser le total des montants par tour, les remboursements, prêts et épargne | Tableau de bord par tontine, données en temps réel | 8 |

### Épique 5 : Portefeuille Électronique

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-5.1 | En tant que système, je crée un wallet automatiquement pour chaque nouveau membre | Wallet créé avec solde 0, devise et pays associés | 3 |
| US-5.2 | En tant que membre, je veux consulter mon solde et l'historique des mouvements | Affichage solde disponible vs bloqué, liste paginée des mouvements | 5 |
| US-5.3 | En tant que système, je crédite le wallet après un paiement externe réussi | Crédit ACID, événement wallet.balance.updated émis | 5 |
| US-5.4 | En tant que système, je débite le wallet pour une contribution tontine | Vérification solde, débit ACID, mise à jour | 5 |
| US-5.5 | En tant que système, je bloque/débloque des fonds pour les opérations en cours | Hold créé/libéré, solde disponible ajusté | 5 |
| US-5.6 | En tant que membre, je veux transférer des fonds à un autre membre | Débit + crédit atomique, journal d'audit | 5 |

### Épique 6 : Transactions

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-6.1 | En tant que système, je crée une transaction interne avec toutes les métadonnées | ID unique, type, montant, devise, initiateur, bénéficiaire, contexte, timestamp | 5 |
| US-6.2 | En tant que système, je valide une transaction (solde, KYC, limites, fraude) | Contrôles appliqués, rejet si échec avec motif | 8 |
| US-6.3 | En tant que système, j'exécute la transaction (débit/crédit ACID) | Opérations atomiques, mise à jour des statuts | 5 |
| US-6.4 | En tant que système, je gère les erreurs avec rollback et compensation | Reverse transaction, notification aux services | 8 |
| US-6.5 | En tant que système, je produis un journal d'audit pour chaque transaction | Métadonnées complètes (IP, device, timestamp, région) | 5 |
| US-6.6 | En tant qu'admin, je veux voir le rapport de réconciliation | Comparaison transactions internes vs paiements externes vs soldes | 8 |

### Épique 7 : Paiements (PSP)

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-7.1 | En tant que membre, je veux alimenter mon wallet via Mobile Money | Intégration M-Pesa/Orange Money/MTN, callback traité, wallet crédité | 13 |
| US-7.2 | En tant que membre, je veux alimenter mon wallet par carte bancaire | Intégration Visa/Mastercard, PCI-DSS respecté | 13 |
| US-7.3 | En tant que membre, je veux retirer des fonds de mon wallet vers mon compte mobile/bancaire | Retrait initié, PSP contacté, confirmation reçue, wallet débité | 8 |
| US-7.4 | En tant que système, je gère les statuts de paiement de bout en bout | Suivi Pending → Completed/Failed, retry, fallback PSP | 8 |
| US-7.5 | En tant que système, je gère les remboursements | Initiation via PSP, reversement interne | 5 |
| US-7.6 | En tant que système, je réconcilie les paiements PSP avec les transactions internes | Détection écarts, rapport de réconciliation | 8 |

### Épique 8 : Notifications & Communication

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-8.1 | En tant que système, je génère une notification pour chaque événement métier important | Transformation événement → alerte structurée | 5 |
| US-8.2 | En tant que système, je personnalise le message (langue, fuseau, canal) | Traduction, variables insérées, format adapté au canal | 5 |
| US-8.3 | En tant que système, j'envoie les messages via SMS/Email avec retry et fallback | Intégration Twilio/SendGrid, DLQ, delivery reports | 8 |
| US-8.4 | En tant que système, je programme des rappels de contribution | Planification, répétition, respect des fuseaux | 5 |
| US-8.5 | En tant que membre, je veux configurer mes préférences de notification | Canal préféré, fréquence, types d'alertes | 3 |

### Épique 9 : Conformité

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-9.1 | En tant que système, je détecte automatiquement le pays/région de l'utilisateur | Géolocalisation IP, documents KYC, profil | 5 |
| US-9.2 | En tant que système, je valide chaque opération selon les règles du pays | Limites, restrictions, interdictions appliquées | 8 |
| US-9.3 | En tant qu'admin plateforme, je veux mettre à jour les règles de conformité sans redéploiement | Interface admin, propagation dynamique, événement compliance.rule.updated | 8 |
| US-9.4 | En tant que système, je détecte et bloque les violations | Blocage opération, suspension membre, alerte fraude | 5 |

### Épique 10 : Administration

| ID | User Story | Critères d'acceptation | Points |
|---|---|---|---|
| US-10.1 | En tant que super-admin, je veux valider les demandes d'accès des admins de tontine | Liste des demandes, validation/rejet, notification | 5 |
| US-10.2 | En tant qu'admin tontine, je veux configurer les comptes de ma tontine | Création compte principal, solidarité, épargne, prêt | 8 |
| US-10.3 | En tant qu'admin, je veux envoyer des messages aux membres de ma tontine | Messagerie ciblée, templates | 5 |
| US-10.4 | En tant qu'admin, je veux générer des rapports financiers de ma tontine | Export PDF/CSV, données par tour/mois/année | 8 |

---

**Vélocité estimée Itération 1** : ~350 points de story — à répartir sur environ 8-10 sprints de 2 semaines avec une équipe de 5-7 développeurs.

---

# PARTIE 4 — ARCHITECTURE

## 4.1 Vue d'ensemble — Architecture Microservices

L'architecture repose sur des microservices indépendants communiquant via un bus d'événements asynchrone et exposés par des API Gateways.

```
┌─────────────────────────────────────────────────────────────────┐
│                    COUCHE PRÉSENTATION                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │ App Web  │  │ App Mobile│  │  Admin   │                     │
│  │ (Bureau) │  │(iOS/Andr)│  │  Console │                     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                     │
│       └──────────────┼─────────────┘                           │
└──────────────────────┼─────────────────────────────────────────┘
                       │ HTTPS/REST
┌──────────────────────┼─────────────────────────────────────────┐
│              API GATEWAY LAYER                                  │
│  ┌───────────────────┴───────────────────┐                     │
│  │         API Gateway (Backend)          │                     │
│  │   - Auth, Rate limiting, Routing       │                     │
│  └───────────────────┬───────────────────┘                     │
│  ┌───────────────────┴───────────────────┐                     │
│  │       API Gateway (Paiement)           │                     │
│  │   - PSP callbacks, Webhooks            │                     │
│  └───────────────────┬───────────────────┘                     │
└──────────────────────┼─────────────────────────────────────────┘
                       │
┌──────────────────────┼─────────────────────────────────────────┐
│              COUCHE SERVICES MÉTIER                             │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │    Auth     │ │   Membres   │ │     KYC     │              │
│  │   Service   │ │   Service   │ │   Service   │              │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘              │
│         │               │               │                      │
│  ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐              │
│  │  Tontines   │ │   Wallet    │ │Transactions │              │
│  │   Service   │ │   Service   │ │   Service   │              │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘              │
│         │               │               │                      │
│  ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐              │
│  │  Paiements  │ │ Conformité  │ │  Rapports   │              │
│  │   Service   │ │   Service   │ │   Service   │              │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘              │
│         │               │               │                      │
│  ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐              │
│  │  Alertes &  │ │Communication│ │ Traduction  │              │
│  │Notifications│ │   Broker    │ │   Service   │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
└────────────────────────┬───────────────────────────────────────┘
                         │
┌────────────────────────┼───────────────────────────────────────┐
│              BUS D'ÉVÉNEMENTS                                   │
│  ┌─────────────────────┴─────────────────────┐                 │
│  │     Apache Kafka / Amazon SQS + SNS       │                 │
│  │  Topics: payment.*, tontine.*, member.*,   │                 │
│  │  wallet.*, kyc.*, compliance.*, fraud.*    │                 │
│  └───────────────────────────────────────────┘                 │
└────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┼───────────────────────────────────────┐
│              COUCHE DONNÉES                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │PostgreSQL│ │  Redis   │ │    S3    │ │Elastics. │          │
│  │(par svc) │ │ (cache)  │ │ (docs,   │ │ (logs,   │          │
│  │          │ │          │ │ rapports)│ │ search)  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
└────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┼───────────────────────────────────────┐
│              OBSERVABILITÉ                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│  │ Grafana  │ │Prometheus│ │  ELK /   │                       │
│  │          │ │          │ │CloudWatch│                       │
│  └──────────┘ └──────────┘ └──────────┘                       │
└────────────────────────────────────────────────────────────────┘
```

## 4.2 Principes architecturaux

**Base de données par service** : Chaque microservice possède sa propre base PostgreSQL. Pas de partage de base entre services. La communication se fait exclusivement par API et événements.

**Event-driven** : Les services communiquent de manière asynchrone via un bus d'événements (Kafka ou SQS/SNS). Chaque service émet des événements métier et consomme ceux des autres services.

**API Gateway** : Deux gateways séparées — une pour le backend (authentification, routing, rate limiting) et une pour les paiements (callbacks PSP, webhooks).

**CQRS pour les rapports** : Le service Rapports consomme les événements pour maintenir des vues matérialisées optimisées pour la lecture, séparées des bases transactionnelles.

## 4.3 Matrice des interactions entre services

| Service émetteur | Événement | Services consommateurs |
|---|---|---|
| Auth | user.registered | Membres |
| Membres | member.created | KYC, Wallet, Tontines |
| Membres | member.updated | Tontines, Notifications |
| Membres | member.status.changed | Tontines, Transactions, Paiements |
| KYC | kyc.verified | Membres, Tontines, Conformité |
| KYC | kyc.rejected | Membres, Notifications |
| Tontines | tontine.cycle.started | Transactions, Notifications |
| Tontines | tontine.cycle.completed | Rapports, Notifications |
| Tontines | tontine.member.added | Wallet, Notifications |
| Wallet | wallet.balance.updated | Tontines, Transactions, Paiements |
| Transactions | transaction.completed | Wallet, Paiements, Rapports |
| Transactions | transaction.failed | Wallet, Notifications |
| Paiements | payment.completed | Transactions, Wallet, Notifications |
| Paiements | payment.failed | Transactions, Notifications |
| Conformité | compliance.rule.updated | Tous les services |
| Conformité | compliance.violation.detected | Membres, Notifications, Fraude |
| Notifications | notification.created | Communication Broker |
| Communication | sms.sent / email.sent | Notifications (delivery report) |

## 4.4 Modèle de déploiement

```
┌─────────────────────────────────────────┐
│              AWS / Azure                │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │        ECS Fargate / AKS          │  │
│  │   (Conteneurs microservices)      │  │
│  │   - Auto-scaling horizontal       │  │
│  │   - Health checks                 │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌──────────┐  ┌──────────┐            │
│  │ RDS      │  │ElastiCache│            │
│  │PostgreSQL│  │  Redis    │            │
│  │(Multi-AZ)│  │ (Cluster) │            │
│  └──────────┘  └──────────┘            │
│                                         │
│  ┌──────────┐  ┌──────────┐            │
│  │ MSK /    │  │    S3    │            │
│  │ SQS+SNS  │  │(Documents│            │
│  │(Events)  │  │ Rapports)│            │
│  └──────────┘  └──────────┘            │
│                                         │
│  Environnements: DEV | STAGING | PROD   │
│                  + FORMATION            │
└─────────────────────────────────────────┘
```

---

# PARTIE 5 — SPÉCIFICATIONS TECHNIQUES

## 5.1 Stack technologique recommandé

| Couche | Technologie | Justification |
|---|---|---|
| Frontend Web (Bureau) | React.js + TypeScript | SPA performante, écosystème riche |
| Frontend Mobile | React Native ou Flutter | Code partagé iOS/Android |
| API Gateway | AWS API Gateway ou Kong | Rate limiting, auth, routing |
| Backend Services | Node.js (NestJS) ou Java (Spring Boot) | Microservices matures, async |
| Bus d'événements | Apache Kafka (ou AWS SQS + SNS) | Fiabilité, scalabilité, replay |
| Base de données | PostgreSQL 15+ | ACID, JSON, extensions financières |
| Cache | Redis 7+ | Sessions, cache traductions, rate limiting |
| Stockage objets | AWS S3 | Documents KYC, rapports, backups |
| Recherche / Logs | Elasticsearch + Kibana | Logs, audit, recherche plein texte |
| Monitoring | Prometheus + Grafana | Métriques, alertes, dashboards |
| CI/CD | GitHub Actions ou GitLab CI | Déploiement automatisé |
| Conteneurs | Docker + ECS Fargate (ou Kubernetes) | Scalabilité horizontale |
| KYC Provider | Onfido, Jumio ou Smile Identity | Vérification Afrique |
| PSP | Flutterwave, Paystack, Stripe | Mobile Money + Cartes |
| SMS | Twilio, Africa's Talking | Couverture Afrique |
| Email | SendGrid ou AWS SES | Fiabilité, templates |
| Traduction | AWS Translate ou Google Cloud Translation | Multi-langue |

## 5.2 Modèle de données — Entités principales

### Service Membres
```
Member {
  id: UUID (PK)
  first_name: VARCHAR(100)
  last_name: VARCHAR(100)
  email: VARCHAR(255) UNIQUE
  phone: VARCHAR(20) UNIQUE
  country_code: VARCHAR(3)
  region: VARCHAR(100)
  language: VARCHAR(5) -- ex: fr-CA, en-US
  timezone: VARCHAR(50)
  status: ENUM(PENDING, ACTIVE, SUSPENDED, KYC_REQUIRED, KYC_IN_REVIEW, KYC_REJECTED)
  kyc_level: ENUM(TIER_1, TIER_2, TIER_3)
  notification_preferences: JSONB
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Service Tontines
```
Tontine {
  id: UUID (PK)
  name: VARCHAR(200)
  type: ENUM(SIMPLE_ROTATIVE, FINANCIERE, ENCHERE, IMMOBILIERE)
  status: ENUM(DRAFT, ACTIVE, PAUSED, COMPLETED, CANCELLED)
  contribution_amount: DECIMAL(15,2)
  currency: VARCHAR(3)
  frequency: ENUM(WEEKLY, BIWEEKLY, MONTHLY, BIMONTHLY)
  frequency_detail: JSONB -- ex: {"day": "wednesday", "week": 1}
  max_members: INTEGER
  start_date: DATE
  draw_mode: ENUM(RANDOM, FIXED_ORDER, PRIORITY)
  penalty_rules: JSONB
  created_by: UUID (FK → Member)
  created_at: TIMESTAMP
}

TontineMember {
  id: UUID (PK)
  tontine_id: UUID (FK)
  member_id: UUID (FK)
  role: ENUM(ADMIN, MEMBER)
  join_date: DATE
  draw_position: INTEGER NULL
  status: ENUM(ACTIVE, SUSPENDED, REMOVED)
}

TontineCycle {
  id: UUID (PK)
  tontine_id: UUID (FK)
  cycle_number: INTEGER
  status: ENUM(PENDING, IN_PROGRESS, COMPLETED, CANCELLED)
  beneficiary_id: UUID (FK → Member) NULL
  start_date: DATE
  end_date: DATE
  total_contributions: DECIMAL(15,2)
}

Contribution {
  id: UUID (PK)
  cycle_id: UUID (FK)
  member_id: UUID (FK)
  amount: DECIMAL(15,2)
  status: ENUM(PENDING, PAID, LATE, DEFAULTED)
  due_date: DATE
  paid_date: TIMESTAMP NULL
  transaction_id: UUID NULL
  penalty_amount: DECIMAL(15,2) DEFAULT 0
}
```

### Service Wallet
```
Wallet {
  id: UUID (PK)
  member_id: UUID (FK)
  balance: DECIMAL(15,2) DEFAULT 0
  blocked_amount: DECIMAL(15,2) DEFAULT 0
  currency: VARCHAR(3)
  status: ENUM(ACTIVE, SUSPENDED, LOCKED, CLOSED)
  created_at: TIMESTAMP
}

WalletMovement {
  id: UUID (PK)
  wallet_id: UUID (FK)
  type: ENUM(CREDIT, DEBIT, HOLD, RELEASE, CORRECTION)
  amount: DECIMAL(15,2)
  balance_after: DECIMAL(15,2)
  context: ENUM(TONTINE_CONTRIBUTION, TONTINE_PAYOUT, DEPOSIT, WITHDRAWAL, TRANSFER, PENALTY, REFUND)
  reference_id: UUID -- ID de la transaction liée
  description: TEXT
  created_at: TIMESTAMP
}
```

### Service Transactions
```
Transaction {
  id: UUID (PK)
  type: ENUM(DEBIT, CREDIT, TRANSFER, CONTRIBUTION, WITHDRAWAL, PENALTY)
  status: ENUM(PENDING, PROCESSING, COMPLETED, FAILED, REJECTED, REVERSED, REFUNDED)
  amount: DECIMAL(15,2)
  currency: VARCHAR(3)
  initiator_id: UUID
  beneficiary_id: UUID
  context_type: ENUM(TONTINE, PAYMENT, WALLET, ADMIN)
  context_id: UUID
  metadata: JSONB -- IP, device, region
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Service Paiements
```
Payment {
  id: UUID (PK)
  type: ENUM(DEPOSIT, WITHDRAWAL, CONTRIBUTION, TRANSFER)
  status: ENUM(PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED, EXPIRED, REFUNDED)
  amount: DECIMAL(15,2)
  currency: VARCHAR(3)
  psp_provider: VARCHAR(50) -- flutterwave, paystack, stripe
  psp_reference: VARCHAR(255)
  payer_id: UUID
  beneficiary_id: UUID
  context_type: ENUM(TONTINE, WALLET, PURCHASE)
  context_id: UUID
  callback_url: TEXT
  error_message: TEXT NULL
  retry_count: INTEGER DEFAULT 0
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

## 5.3 Sécurité

**Authentification** : JWT avec access token (15 min) + refresh token (7 jours). Rotation des clés. Blacklist des tokens révoqués via Redis.

**Autorisation** : RBAC (Role-Based Access Control) avec 4 rôles principaux (Super-admin, Admin tontine, Gestionnaire, Membre). Chaque endpoint vérifie le rôle et le périmètre (un admin ne voit que ses tontines).

**Chiffrement** : TLS 1.3 en transit. AES-256 au repos pour les données sensibles (documents KYC, informations bancaires). Hachage bcrypt pour les mots de passe.

**Protection** : Rate limiting par IP et par utilisateur, protection CSRF, validation d'entrées (injection SQL, XSS), CORS restrictif, headers de sécurité (HSTS, CSP).

**PCI-DSS** : Aucune donnée carte stockée côté TontineMoney — délégation totale au PSP via tokenisation.

**Audit** : Chaque opération sensible génère une entrée d'audit avec timestamp, IP, device, utilisateur, action, résultat. Conservation minimum 5 ans.

## 5.4 Patterns techniques clés

**Saga Pattern** : Pour les transactions distribuées (contribution tontine = débit wallet + création transaction + mise à jour cycle). Orchestration via le service Transactions avec compensation en cas d'échec.

**Circuit Breaker** : Sur les appels aux PSP et fournisseurs externes (KYC, SMS, Email). Fallback automatique vers un fournisseur alternatif.

**Outbox Pattern** : Pour garantir la cohérence entre écriture en base et émission d'événements. Chaque service écrit l'événement dans une table outbox locale, un worker le publie sur Kafka.

**Idempotence** : Chaque opération financière utilise une clé d'idempotence pour éviter les doublons en cas de retry.

**Optimistic Locking** : Sur les wallets pour gérer les accès concurrents au solde.

## 5.5 API Design

**Standard** : REST JSON, versionnement via URL (`/api/v1/...`), pagination par curseur, format d'erreur uniforme.

**Exemple endpoint — Création de tontine** :
```
POST /api/v1/tontines
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "Tontine Solidarité 2026",
  "type": "SIMPLE_ROTATIVE",
  "contribution_amount": 50000,
  "currency": "XAF",
  "frequency": "MONTHLY",
  "frequency_detail": { "day": "wednesday", "week": 1 },
  "max_members": 12,
  "start_date": "2026-06-01",
  "draw_mode": "RANDOM",
  "penalty_rules": {
    "late_fee_percent": 5,
    "grace_period_days": 3,
    "suspension_after_defaults": 2
  }
}

Response 201:
{
  "id": "uuid-...",
  "status": "DRAFT",
  "created_at": "2026-04-14T10:00:00Z"
}
```

## 5.6 Stratégie de sauvegarde

| Type | Fréquence | Rétention | Stockage |
|---|---|---|---|
| Snapshot base PostgreSQL | Quotidien | 30 jours | RDS automated backups |
| WAL (Point-in-time recovery) | Continu | 7 jours | RDS |
| Export complet | Hebdomadaire | 1 an | S3 + disque externe |
| Backup hors site | Mensuel | 2 ans | Azure Blob (géographiquement séparé) |
| Documents KYC | À la création | Durée légale (5 ans min) | S3 chiffré |

## 5.7 Environnements

| Environnement | Usage | Infrastructure |
|---|---|---|
| DEV | Développement, tests unitaires | Conteneurs locaux ou cloud léger |
| STAGING | Tests d'intégration, QA | Réplique de PROD à échelle réduite |
| FORMATION | Formation utilisateurs, démos | Données fictives, PSP sandbox |
| PROD | Production | Haute disponibilité, Multi-AZ |

---

# ANNEXE — ROADMAP ITÉRATIVE

| Itération | Durée estimée | Contenu |
|---|---|---|
| **1 — MVP Bureau** | 16-20 semaines | Auth, Membres, KYC, Tontine simple, Wallet, Transactions, Paiements (1 PSP), Notifications, Conformité de base, Admin |
| **2 — Mobile + Enrichissement** | 12-16 semaines | App mobile, Rapports avancés, Traduction, Comptes multiples (solidarité, épargne, prêt), Module de calcul (intérêts, pénalités) |
| **3 — Tontines avancées** | 12-16 semaines | Tontine financière avec caisse de prêts, Tontine avec enchères, Vente de parts, PSP additionnels |
| **4 — Extension** | À définir | Tontine immobilière, Analytique ML, Intégrations bancaires avancées |
