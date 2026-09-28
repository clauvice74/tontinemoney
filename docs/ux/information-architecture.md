# Architecture de l'information

## 1. Espaces et rôles

| Espace                    | Rôles                               | Objectif                                                     | Navigation                                                     |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Public                    | visiteur                            | découvrir, s'inscrire, se connecter, accepter une invitation | en-tête public                                                 |
| Membre                    | MEMBER, TONTINE_ADMIN               | épargner : tontines, wallet, contributions, KYC              | barre basse (mobile), sidebar (desktop)                        |
| Administration de tontine | membre administrateur d'une tontine | gérer sa tontine                                             | sidebar « Administration » + onglets de la tontine             |
| Plateforme                | SUPER_ADMIN                         | piloter la plateforme                                        | sidebar : Accueil, Tontines, Wallet, Reporting, Administration |
| Revue                     | KYC_AGENT, COMPLIANCE_AGENT         | traiter les dossiers                                         | sidebar dédiée                                                 |

## 2. Navigation (charte §09)

- **Mobile (< 1024 px), espace membre** : barre basse navy à 5 destinations — Accueil, Tontines,
  Wallet, Notifications (pastille non lues), Profil ; tiroir pour les rubriques secondaires
  (Reporting, Administration).
- **Desktop (≥ 1024 px)** : sidebar navy — Accueil, Tontines, Wallet, Reporting, Administration
  (Reporting et Administration seulement si le rôle y donne accès) ; indicateur actif or, texte
  actif or pâle ; en-tête : notifications et menu du compte (Profil, Vérification d'identité,
  Sécurité, Langue, Apparence, Se déconnecter).

## 3. Objets et contenus

| Objet        | Contenu affiché                                                              | Statuts (badges)                                                   |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Wallet       | solde, disponible, bloqué, historique, filtres                               | actif, suspendu, gelé                                              |
| Tontine      | nom, montant, devise, fréquence, membres, progression, prochain bénéficiaire | brouillon, prête, active (Actif), en pause, clôturée               |
| Cycle        | numéro, échéance, bénéficiaire, collecté / attendu                           | à venir, en cours, versement en cours, terminé                     |
| Contribution | montant, pénalité, échéance, date de paiement                                | à payer (Prochain), payée, en retard, en défaut, paiement en cours |
| Transaction  | type, montant, date, référence (mono)                                        | en attente, complétée, échouée, rejetée                            |
| Dossier KYC  | niveau, documents, motif de rejet                                            | vérification requise, en cours (KYC en cours), validé, rejeté      |
| Notification | type (Paiement, Rappel, Système, KYC, Wallet), date, lu / non lu             | Nouveau                                                            |

## 4. Libellés

Français par défaut, anglais disponible (menu du compte). Termes stables : « Wallet », « Tontine »,
« Contribution » (« cotisation » dans les textes explicatifs), « Bénéficiaire », « Cycle ».
Jamais de majuscules forcées ; phrases courtes.
