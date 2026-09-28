# Wireframes basse fidélité

Grille 4 px, mobile d'abord (320 → 768 → 1024 → 1440). `[CTA]` = bouton principal or (un seul
par écran), `[ Secondaire ]`, `( Contour )`, `‹ Ghost ›`. Les écrans haute fidélité sont réalisés
directement dans l'application (prototype interactif) et dans le UI kit (`/dev/ui-kit`).

## Bienvenue (mobile)

```
┌──────────────────────────┐
│ [logo] TontineMoney      │
│                          │
│  Épargnez ensemble,      │  H1 32
│  en toute confiance      │
│  Tontines, wallet et     │  corps 14
│  paiements sécurisés.    │
│                          │
│  ✓ Fonds protégés        │
│  ✓ Tours transparents    │
│  ✓ Mobile Money          │
│                          │
│ [   Créer mon compte   ] │  CTA or
│ (     Se connecter     ) │
└──────────────────────────┘
```

## Inscription → OTP → mot de passe

```
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ ‹ Retour      │  │ Code reçu par │  │ Créez votre   │
│ Inscription   │  │ SMS au +237…  │  │ mot de passe  │
│ Nom  [      ] │  │ [_][_][_][_]  │  │ [ ••••••••  ] │
│ Prénom[     ] │  │ [_][_]        │  │ [ ••••••••  ] │
│ Tél. [+237  ] │  │ 14:32 restant │  │ ▮▮▮▯ robuste  │
│ E-mail[     ] │  │ Renvoyer le   │  │ ✓ 12 caract.  │
│ Code invit.   │  │ code          │  │ ✓ chiffre …   │
│ [ Continuer ] │  │[Valider le code]│ │ [ Continuer ] │
└───────────────┘  └───────────────┘  └───────────────┘
```

## Accueil membre (mobile / desktop)

```
Mobile                         Desktop (sidebar navy)
┌──────────────────────────┐   ┌────────┬─────────────────────────────────────┐
│ ≡ [logo]           (AV)  │   │ logo   │ Bonjour Awa                    (AV) │
│ Bonjour Awa              │   │▌Accueil│ ┌ Solde ─────────┐ ┌ Prochaine ────┐ │
│ ┌ Solde wallet ────────┐ │   │ Tontin.│ │ 125 000 XAF    │ │ 10 000 XAF    │ │
│ │ 125 000 XAF          │ │   │ Wallet │ │ Dispo · Bloqué │ │ le 7 nov.     │ │
│ │ Dispo 115k · Bloq 10k│ │   │ Report.│ └────────────────┘ │[Payer ma cont.]│ │
│ └──────────────────────┘ │   │ Admin. │ ┌ Tontines actives ┐ ┌ Notifs ──────┐ │
│ ┌ Prochaine contrib. ──┐ │   │        │ │ ▰▰▰▱ 7/12        │ │ • Rappel     │ │
│ │ 10 000 XAF · 7 nov.  │ │   │        │ └──────────────────┘ └──────────────┘ │
│ │[Payer ma contribution]│ │   │        │ ┌ Historique récent ────────────────┐ │
│ └──────────────────────┘ │   │        │ │ −10 000 Contribution  7 oct.      │ │
│ Tontines actives  →      │   │        │ └───────────────────────────────────┘ │
│ Historique récent →      │   └────────┴─────────────────────────────────────┘
│ Notifications     →      │
├──────────────────────────┤
│ ⌂  👥  ▣  🔔3  👤         │   barre basse navy, indicateur or
└──────────────────────────┘
```

## Tontines : liste, détail, création

```
Liste (carte)                  Détail                         Assistant (4 étapes)
┌──────────────────────┐       ┌──────────────────────────┐   ┌──────────────────────┐
│ Famille     [Actif]  │       │ Famille  [Actif]         │   │ ●──○──○──○  1/4 Type │
│ 50 000 XAF · mensuel │       │ 6 membres · 50 000 XAF   │   │ ( Rotative )         │
│ 6 membres            │       │ ▰▰▰▰▰▰▰▱▱▱▱▱ cycle 7/12  │   │ ( À priorité )       │
│ ▰▰▰▰▱▱ 7/12          │       │ Cycles  ✓1 ✓2 … ◉7 ○8    │   │ 2/4 Montant, devise, │
│ Prochain : Bella     │       │ Membres (AV AV AV …)     │   │     fréquence        │
│ ( Voir les détails ) │       │ Historique · Contrib.    │   │ 3/4 Règles           │
└──────────────────────┘       │ [ Inviter un membre ]    │   │ 4/4 Invitations      │
                               └──────────────────────────┘   │ [ Créer la tontine ] │
                                                              └──────────────────────┘
```

## Wallet, dépôt, retrait

```
┌──────────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Solde 125 000 XAF        │  │ Dépôt            │  │ Retrait          │
│ Bloqué 10 000 XAF        │  │ Montant [      ] │  │ Dispo 115 000    │
│ [Ajouter de l'argent]    │  │ ( Mobile Money ) │  │ Montant [      ] │
│ ( Retirer mes fonds )    │  │ ( Carte )        │  │ Compte [+237…  ] │
│ Filtres: Tous|Entrées|…  │  │ Récapitulatif    │  │ OTP [_][_][_]…   │
│ −10 000 Contribution     │  │ [  Confirmer   ] │  │ [   Retirer    ] │
└──────────────────────────┘  └──────────────────┘  └──────────────────┘
```

## KYC, notifications, profil

```
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Vérification         │  │ Notifications        │  │ (AV) Awa Diallo      │
│ [Vérification requise]│ │ Paiement|Rappel|…    │  │ Infos personnelles › │
│ Pièce : recto verso  │  │ • Paiement reçu  2h  │  │ Adresse            › │
│ Selfie : caméra |    │  │   Voir · Marquer lu  │  │ Langue : Français  › │
│          galerie     │  │ • Rappel …       1j  │  │ Préférences        › │
│[Envoyer mes documents]│ │                      │  │ Sécurité · Sessions ›│
└──────────────────────┘  └──────────────────────┘  │ MFA                › │
                                                    └──────────────────────┘
```

## Administration (desktop)

```
┌────────┬─────────────────────────────────────────────────────────┐
│ sidebar│ Tableau de bord                                          │
│        │ [Membres 1 248] [Wallet 12,4 M XAF] [Contrib. 96 %]      │
│        │ [Retards 14]    [Cycles en cours 38]                     │
│        │ Membres : recherche [      ] Filtre (Statut ▾)           │
│        │ ┌ Nom ─────────── Statut ─── KYC ──── Actions ▾ ┐       │
│        │ │ Awa Diallo      Actif      Niv. 2   Voir|Susp. │       │
│        │ └────────────────────────────────────────────────┘       │
└────────┴─────────────────────────────────────────────────────────┘
```
