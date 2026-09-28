# Design system TontineMoney

Source : charte graphique v1.0 (« TontineMoney_Charte Graphique.docx », avril 2025). Implémentation :
`packages/ui` (jetons `src/theme.css`, composants React + Tailwind CSS 4). Rendu réel de tous les
éléments : **`/dev/ui-kit`** (développement et builds de démonstration). Décisions : A-56.

## 1. Principes

Confiance, transparence, simplicité. Mobile d'abord. WCAG AA sur toute combinaison texte / fond.
Un seul bouton principal (or) par écran. Solde affiché avant tout paiement, statut avant toute
action, confirmation avant toute action irréversible. États chargement, vide, erreur, succès partout.

## 2. Couleurs

| Jeton                                       | Clair             | Rôle                                                     |
| ------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `navy` / `primary`                          | #042C53           | navigation, en-têtes, texte principal, bouton secondaire |
| `navy-mid` / `info` / `ring`                | #185FA5           | liens, focus, information                                |
| `navy-light` / `secondary` / `info-soft`    | #E6F1FB           | fonds informatifs, badges KYC                            |
| `gold` / `progress` / `nav-indicator`       | #BA7517           | barres de progression, indicateur actif                  |
| `gold-vivid` / `cta`                        | #EF9F27           | **bouton principal (texte navy)**                        |
| `gold-pale` / `warning-soft` / `nav-active` | #FAEEDA           | texte sur navy, badge « Prochain »                       |
| `success` / `success-soft`                  | #3B6D11 / #EAF3DE | payé, actif, complété                                    |
| `warning`                                   | #854F0B           | prochain versement, KYC en attente                       |
| `destructive` / `destructive-soft`          | #A32D2D / #FCEBEB | échec, rejet, fraude                                     |
| `neutral` / `muted-foreground`              | #5F5E5A           | texte secondaire, suspendu                               |
| `surface` / `background` / `muted`          | #F1EFE8           | fond de page, lignes paires                              |

Mode sombre : dérivé du navy (fond #021B33, cartes #06325C, texte #F1EFE8, CTA or vif inchangé),
suivant la préférence du système ou le choix de l'utilisateur (menu du compte, cookie `tm_theme`).

### Contrastes vérifiés

| Couple                                        | Rapport                            |
| --------------------------------------------- | ---------------------------------- |
| Navy / surface                                | 12,25:1                            |
| Bouton principal : navy / or vif              | 6,48:1                             |
| Navigation : or pâle / navy                   | 12,28:1                            |
| Lien, focus : navy moyen / blanc              | 6,52:1                             |
| Texte secondaire : neutre / blanc · / surface | 6,49:1 · 5,64:1                    |
| Badges succès · avertissement · erreur · info | 5,43 · 5,87 · 6,13 · 5,70:1        |
| Progression : or / surface (composant)        | 3,23:1 (≥ 3:1)                     |
| Bordure de champ / blanc (composant)          | 3,80:1 (≥ 3:1)                     |
| **Écarté** : blanc / or #BA7517               | 3,72:1 — insuffisant pour du texte |

## 3. Typographie

Arial, Helvetica, sans-serif. Deux graisses : 400 et 500 (`font-semibold` et `font-bold` sont
ramenés à 500 dans le thème). Jamais de majuscules forcées.

| Niveau     | Classe                | Taille / graisse                       |
| ---------- | --------------------- | -------------------------------------- |
| H1         | `text-h1`             | 32 px · 500                            |
| H2         | `text-h2`             | 24 px · 500                            |
| H3         | `text-h3`             | 18 px · 500                            |
| Corps      | `text-body` (défaut)  | 14 px · 400                            |
| Secondaire | `text-caption`        | 12 px · 400                            |
| Mono       | `font-mono text-mono` | 11 px · 400 (références, identifiants) |

Montants : valeur en 500 (`tabular-nums`), devise en texte secondaire.

## 4. Espacements et rayons

Grille 4 px : 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48. Rayons : inline 4 px (`rounded-sm`),
champs 8 px (`rounded-md`), cartes 12 px (`rounded-lg`), modales 16 px (`rounded-xl`), avatars
50 % (`rounded-full`).

## 5. Composants (`@tontine/ui`)

| Composant                                              | Variantes / API                                                                                                                                   | Règles                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `Button`                                               | `primary` (CTA or), `secondary` (navy, défaut), `outline`, `ghost`, `danger`, `link` ; tailles `sm` / `md` / `lg` / `icon` ; `loading`, `asChild` | un seul `primary` par écran ; `danger` après confirmation |
| `Badge`                                                | `success` (Actif), `warning` (Prochain), `info` (KYC en cours), `destructive` (Rejeté), `muted` (Suspendu), `new` (Nouveau), `gold`               | fond clair + texte foncé                                  |
| `Alert`                                                | `success`, `warning`, `destructive`, `info`                                                                                                       | erreurs et avertissements annoncés (`role="alert"`)       |
| `toast()`                                              | `default`, `success`, `destructive`, `warning`, `info`                                                                                            | confirmations courtes                                     |
| `Card`                                                 | `CardHeader`, `CardTitle` (H3), `CardContent`, `CardFooter`                                                                                       | rayon 12 px                                               |
| `KpiCard`                                              | `label`, `value`, `unit`, `hint`, `tone`, `icon`                                                                                                  | tableaux de bord                                          |
| `ProgressBar`                                          | `value`, `max`, `label`, `valueText`, `showLabel`                                                                                                 | or uniquement, `role="progressbar"`                       |
| `Avatar`                                               | `name`, `seed`, `size` (`lg` 44, `md` 36, `sm` 28), `src`                                                                                         | initiales, teinte stable par membre                       |
| `Timeline`                                             | `items` (`done`, `current`, `upcoming`, `failed`)                                                                                                 | liste ordonnée, étape courante `aria-current`             |
| `Table`                                                | `Table*`                                                                                                                                          | lignes paires sur la surface                              |
| `Dialog` (modale)                                      | `DialogContent`, `DialogHeader`, `DialogFooter`                                                                                                   | rayon 16 px, focus piégé                                  |
| `Dropdown`                                             | `DropdownTrigger`, `DropdownContent`, `DropdownItem` (`destructive`), `DropdownLabel`, `DropdownSeparator`                                        | clavier complet (Radix)                                   |
| `FormField`, `Input`, `Select`, `Textarea`, `Checkbox` | libellé, description, erreur reliés (`aria-describedby`)                                                                                          | rayon 8 px, bordure ≥ 3:1                                 |
| `EmptyState`, `LoadingBlock`, `Skeleton`               | états vide et chargement                                                                                                                          | —                                                         |

## 6. Navigation

`apps/web/src/components/app-shell.tsx` : sidebar navy (≥ 1024 px) — Accueil, Tontines, Wallet,
Reporting, Administration selon le rôle ; barre basse navy (< 1024 px, espace membre) — Accueil,
Tontines, Wallet, Notifications, Profil ; menu du compte (profil, KYC, sécurité, langue,
apparence, déconnexion) ; lien d'évitement « Aller au contenu ». Modèle :
`apps/web/src/lib/navigation.ts`.

## 7. Accessibilité

Contrastes AA (§2), focus visible navy moyen (or pâle sur navy), navigation clavier complète
(menus Radix, groupes de la sidebar en `aria-expanded`), `aria-current` sur la page active,
pastilles de notifications doublées d'un libellé accessible, mouvements réduits respectés
(`prefers-reduced-motion`), cibles tactiles ≥ 40 px, points de rupture 320 / 768 / 1024 / 1440.

## 8. Langues

Français (défaut) et anglais : `apps/web/src/lib/i18n` — dictionnaires typés (`fr.ts` fait
référence, `en.ts` doit avoir les mêmes clés, vérifié à la compilation et par test), `useI18n()`
(`t`, `locale`, `setLocale`, `theme`, `setTheme`, `intlLocale`). Préférence dans le cookie
`tm_locale`, lue côté serveur (`<html lang>` correct dès le premier rendu).
