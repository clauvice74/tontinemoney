import {
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPriority,
} from '@tontine/contracts';

/**
 * Catalogue des modèles de messages (US-8.2) : type × langue, variables `{nom}`.
 * - `sms` : variante courte SANS montant ni numéro de compte (R-NOT-02) ;
 * - `sensitive` : variables masquées dans l'historique stocké (liens, codes).
 * Canaux et priorités par défaut : P2 §8.2.
 */
export interface LocalizedTemplate {
  title: string;
  body: string;
  sms?: string;
}

export interface TemplateDefinition {
  category: NotificationCategory;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  sensitive?: string[];
  fr: LocalizedTemplate;
  en: LocalizedTemplate;
}

const T = (d: TemplateDefinition): TemplateDefinition => d;

export const TEMPLATES = {
  // --- Compte & sécurité ---
  'auth.activation_link': T({
    category: 'ACCOUNT',
    priority: 'HIGH',
    channels: ['EMAIL', 'SMS'],
    sensitive: ['lien'],
    fr: {
      title: 'Activez votre compte TontineMoney',
      body: 'Bonjour {prenom}, votre compte TontineMoney a été créé. Activez-le avant 48 h : {lien}',
      sms: 'TontineMoney : activez votre compte (valable 48h) : {lien}',
    },
    en: {
      title: 'Activate your TontineMoney account',
      body: 'Hello {prenom}, your TontineMoney account has been created. Activate it within 48 hours: {lien}',
      sms: 'TontineMoney: activate your account (valid 48h): {lien}',
    },
  }),
  'auth.activation_otp': T({
    category: 'ACCOUNT',
    priority: 'HIGH',
    channels: ['SMS'],
    sensitive: ['code'],
    fr: {
      title: 'Code d’activation',
      body: 'Votre code d’activation TontineMoney : {code} (valable 15 minutes).',
      sms: 'TontineMoney : code d’activation {code} (15 min). Ne le partagez pas.',
    },
    en: {
      title: 'Activation code',
      body: 'Your TontineMoney activation code: {code} (valid 15 minutes).',
      sms: 'TontineMoney: activation code {code} (15 min). Do not share it.',
    },
  }),
  'auth.password_reset_link': T({
    category: 'SECURITY',
    priority: 'HIGH',
    channels: ['EMAIL'],
    sensitive: ['lien'],
    fr: {
      title: 'Réinitialisation du mot de passe',
      body: 'Pour choisir un nouveau mot de passe (lien valable 1 h, usage unique) : {lien}. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.',
      sms: 'TontineMoney : réinitialisez votre mot de passe (1h) : {lien}',
    },
    en: {
      title: 'Password reset',
      body: 'To choose a new password (link valid 1 hour, single use): {lien}. If you did not request this, ignore this message.',
      sms: 'TontineMoney: reset your password (1h): {lien}',
    },
  }),
  'auth.password_reset_done': T({
    category: 'SECURITY',
    priority: 'HIGH',
    channels: ['EMAIL', 'SMS'],
    fr: {
      title: 'Mot de passe modifié',
      body: 'Votre mot de passe a été réinitialisé et toutes vos sessions ont été fermées. Contactez le support si ce n’était pas vous.',
    },
    en: {
      title: 'Password changed',
      body: 'Your password has been reset and all sessions were closed. Contact support if this was not you.',
    },
  }),
  'auth.mfa_sms_code': T({
    category: 'SECURITY',
    priority: 'URGENT',
    channels: ['SMS'],
    sensitive: ['code'],
    fr: {
      title: 'Code de vérification',
      body: 'Votre code de vérification TontineMoney : {code}',
      sms: 'TontineMoney : code {code}. Ne le communiquez à personne.',
    },
    en: {
      title: 'Verification code',
      body: 'Your TontineMoney verification code: {code}',
      sms: 'TontineMoney: code {code}. Never share it.',
    },
  }),
  'auth.new_device': T({
    category: 'SECURITY',
    priority: 'URGENT',
    channels: ['SMS', 'IN_APP'],
    fr: {
      title: 'Nouvelle connexion',
      body: 'Nouvelle connexion à votre compte depuis un appareil inconnu ({appareil}). Si ce n’est pas vous, changez votre mot de passe.',
      sms: 'TontineMoney : nouvelle connexion depuis un appareil inconnu. Pas vous ? Changez votre mot de passe.',
    },
    en: {
      title: 'New sign-in',
      body: 'New sign-in to your account from an unknown device ({appareil}). If this was not you, change your password.',
      sms: 'TontineMoney: new sign-in from an unknown device. Not you? Change your password.',
    },
  }),
  'auth.account_locked': T({
    category: 'SECURITY',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL'],
    fr: {
      title: 'Compte verrouillé',
      body: 'Votre compte a été verrouillé après de nombreuses tentatives de connexion échouées. Contactez votre administrateur.',
    },
    en: {
      title: 'Account locked',
      body: 'Your account was locked after many failed sign-in attempts. Contact your administrator.',
    },
  }),
  'auth.mfa_enabled': T({
    category: 'SECURITY',
    priority: 'HIGH',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Double authentification activée',
      body: 'La double authentification ({mode}) est maintenant active sur votre compte.',
    },
    en: {
      title: 'Two-factor authentication enabled',
      body: 'Two-factor authentication ({mode}) is now active on your account.',
    },
  }),
  'auth.mfa_disabled': T({
    category: 'SECURITY',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL'],
    fr: {
      title: 'Double authentification désactivée',
      body: 'Alerte : la double authentification a été désactivée sur votre compte. Si ce n’est pas vous, contactez immédiatement le support.',
    },
    en: {
      title: 'Two-factor authentication disabled',
      body: 'Alert: two-factor authentication was disabled on your account. If this was not you, contact support immediately.',
    },
  }),
  'auth.mfa_recovery_exhausted': T({
    category: 'SECURITY',
    priority: 'HIGH',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Codes de récupération épuisés',
      body: 'Vous avez utilisé tous vos codes de récupération. Générez-en de nouveaux depuis vos paramètres de sécurité.',
    },
    en: {
      title: 'Recovery codes exhausted',
      body: 'You have used all your recovery codes. Generate new ones from your security settings.',
    },
  }),
  'auth.access_request_received': T({
    category: 'ADMIN',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Nouvelle demande d’accès',
      body: '{demandeur} demande à rejoindre {cible}. Traitez la demande depuis votre tableau de bord.',
    },
    en: {
      title: 'New access request',
      body: '{demandeur} asks to join {cible}. Handle the request from your dashboard.',
    },
  }),
  'auth.access_rejected': T({
    category: 'ACCOUNT',
    priority: 'MEDIUM',
    channels: ['EMAIL'],
    fr: {
      title: 'Demande de compte refusée',
      body: 'Votre demande de compte n’a pas été acceptée. Motif : {motif}',
    },
    en: {
      title: 'Account request declined',
      body: 'Your account request was not accepted. Reason: {motif}',
    },
  }),
  'auth.access_expired': T({
    category: 'ACCOUNT',
    priority: 'LOW',
    channels: ['EMAIL'],
    fr: {
      title: 'Demande de compte expirée',
      body: 'Votre demande de compte n’a pas été traitée sous 30 jours et a expiré. Vous pouvez en soumettre une nouvelle.',
    },
    en: {
      title: 'Account request expired',
      body: 'Your account request was not processed within 30 days and has expired. You may submit a new one.',
    },
  }),

  // --- Membres ---
  'member.accepted': T({
    category: 'ACCOUNT',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Adhésion acceptée',
      body: 'Votre adhésion à la tontine {tontine} a été acceptée.',
    },
    en: {
      title: 'Membership accepted',
      body: 'Your membership in the {tontine} tontine was accepted.',
    },
  }),
  'member.rejected': T({
    category: 'ACCOUNT',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Adhésion refusée',
      body: 'Votre demande d’adhésion à {tontine} a été refusée. Motif : {motif}',
    },
    en: {
      title: 'Membership declined',
      body: 'Your request to join {tontine} was declined. Reason: {motif}',
    },
  }),
  'member.kyc_required': T({
    category: 'KYC',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Vérifiez votre identité',
      body: 'Votre profil est complet. Dernière étape : vérifiez votre identité (pièce + selfie) pour participer aux tontines.',
    },
    en: {
      title: 'Verify your identity',
      body: 'Your profile is complete. Last step: verify your identity (ID + selfie) to join tontines.',
    },
  }),
  'member.suspended': T({
    category: 'SECURITY',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL'],
    fr: {
      title: 'Compte suspendu',
      body: 'Votre compte a été suspendu. Aucune opération n’est possible. Motif : {motif}',
      sms: 'TontineMoney : votre compte est suspendu. Consultez vos emails.',
    },
    en: {
      title: 'Account suspended',
      body: 'Your account has been suspended. No operation is possible. Reason: {motif}',
      sms: 'TontineMoney: your account is suspended. Check your email.',
    },
  }),
  'member.reactivated': T({
    category: 'ACCOUNT',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: { title: 'Compte réactivé', body: 'La suspension de votre compte a été levée.' },
    en: { title: 'Account reactivated', body: 'Your account suspension has been lifted.' },
  }),

  // --- KYC ---
  'kyc.submitted': T({
    category: 'KYC',
    priority: 'LOW',
    channels: ['IN_APP'],
    fr: { title: 'Documents reçus', body: 'Vos documents sont en cours de vérification.' },
    en: { title: 'Documents received', body: 'Your documents are being verified.' },
  }),
  'kyc.verified': T({
    category: 'KYC',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'PUSH', 'IN_APP'],
    fr: {
      title: 'Identité vérifiée',
      body: 'Votre identité est vérifiée (niveau {niveau}). Vous pouvez participer aux tontines.',
    },
    en: {
      title: 'Identity verified',
      body: 'Your identity is verified (level {niveau}). You can now join tontines.',
    },
  }),
  'kyc.rejected': T({
    category: 'KYC',
    priority: 'HIGH',
    channels: ['SMS', 'EMAIL', 'IN_APP'],
    fr: {
      title: 'Vérification refusée',
      body: 'Votre vérification d’identité a été refusée ({categorie}). {motif} Vous pouvez soumettre de nouveaux documents.',
      sms: 'TontineMoney : vérification d’identité refusée. Détails dans l’application.',
    },
    en: {
      title: 'Verification declined',
      body: 'Your identity verification was declined ({categorie}). {motif} You may submit new documents.',
      sms: 'TontineMoney: identity verification declined. Details in the app.',
    },
  }),
  'kyc.in_review': T({
    category: 'KYC',
    priority: 'LOW',
    channels: ['IN_APP'],
    fr: {
      title: 'Vérification en cours',
      body: 'Votre dossier nécessite une vérification complémentaire par un agent (sous 24 h ouvrées).',
    },
    en: {
      title: 'Verification in progress',
      body: 'Your file requires an additional review by an agent (within 1 business day).',
    },
  }),
  'kyc.review_queue': T({
    category: 'ADMIN',
    priority: 'MEDIUM',
    channels: ['IN_APP', 'EMAIL'],
    fr: {
      title: 'Dossier KYC à traiter',
      body: 'Un dossier KYC nécessite une revue manuelle ({etapes}).',
    },
    en: { title: 'KYC file to review', body: 'A KYC file requires manual review ({etapes}).' },
  }),
  'kyc.supplement_requested': T({
    category: 'KYC',
    priority: 'HIGH',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Documents complémentaires demandés',
      body: 'Un agent demande des documents complémentaires : {message}',
    },
    en: {
      title: 'Additional documents requested',
      body: 'An agent requests additional documents: {message}',
    },
  }),
  'kyc.expiring_30': T({
    category: 'KYC',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Pièce d’identité bientôt expirée',
      body: 'Votre pièce d’identité expire dans {jours} jours. Pensez à la renouveler.',
    },
    en: {
      title: 'ID document expiring soon',
      body: 'Your ID document expires in {jours} days. Please renew it.',
    },
  }),
  'kyc.expiring_7': T({
    category: 'KYC',
    priority: 'HIGH',
    channels: ['SMS', 'EMAIL'],
    fr: {
      title: 'Pièce d’identité expire bientôt',
      body: 'Urgent : votre pièce d’identité expire dans {jours} jours. Soumettez un nouveau document.',
      sms: 'TontineMoney : votre pièce d’identité expire dans {jours} jours. Mettez-la à jour.',
    },
    en: {
      title: 'ID document expiring',
      body: 'Urgent: your ID document expires in {jours} days. Submit a new document.',
      sms: 'TontineMoney: your ID expires in {jours} days. Please update it.',
    },
  }),
  'kyc.expired': T({
    category: 'KYC',
    priority: 'HIGH',
    channels: ['SMS', 'EMAIL', 'IN_APP'],
    fr: {
      title: 'Pièce d’identité expirée',
      body: 'Votre pièce d’identité a expiré : votre niveau de vérification a été abaissé. Soumettez un nouveau document sous 30 jours pour conserver vos opérations.',
    },
    en: {
      title: 'ID document expired',
      body: 'Your ID document has expired: your verification level was lowered. Submit a new document within 30 days to keep your operations.',
    },
  }),
  'kyc.operations_suspended': T({
    category: 'KYC',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL'],
    fr: {
      title: 'Opérations suspendues',
      body: 'Faute de renouvellement de votre pièce d’identité, vos opérations financières sont suspendues.',
    },
    en: {
      title: 'Operations suspended',
      body: 'As your ID document was not renewed, your financial operations are suspended.',
    },
  }),
  'kyc.duplicate_alert': T({
    category: 'ADMIN',
    priority: 'URGENT',
    channels: ['IN_APP', 'EMAIL'],
    fr: {
      title: 'Doublon biométrique détecté',
      body: 'Similarité {score} % entre deux dossiers. Le nouveau compte est bloqué en attente de revue.',
    },
    en: {
      title: 'Biometric duplicate detected',
      body: '{score}% similarity between two files. The new account is blocked pending review.',
    },
  }),

  // --- Tontines ---
  'tontine.invitation': T({
    category: 'TONTINE',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'SMS', 'IN_APP'],
    sensitive: ['lien'],
    fr: {
      title: 'Invitation à une tontine',
      body: 'Vous êtes invité(e) à rejoindre la tontine « {tontine} » : {montant} {frequence}, début le {dateDebut}. Répondez ici : {lien}',
      sms: 'TontineMoney : invitation à la tontine {tontine}. Répondez : {lien}',
    },
    en: {
      title: 'Tontine invitation',
      body: 'You are invited to join the “{tontine}” tontine: {montant} {frequence}, starting {dateDebut}. Respond here: {lien}',
      sms: 'TontineMoney: invitation to the {tontine} tontine. Respond: {lien}',
    },
  }),
  'tontine.member_added': T({
    category: 'TONTINE',
    priority: 'LOW',
    channels: ['IN_APP'],
    fr: { title: 'Nouveau membre', body: 'Un nouveau membre a rejoint la tontine {tontine}.' },
    en: { title: 'New member', body: 'A new member joined the {tontine} tontine.' },
  }),
  'tontine.ready': T({
    category: 'TONTINE',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Tontine prête',
      body: 'La tontine {tontine} compte {nombre} membres et démarrera à la date prévue si toutes les conditions sont remplies.',
    },
    en: {
      title: 'Tontine ready',
      body: 'The {tontine} tontine has {nombre} members and will start on schedule if all conditions are met.',
    },
  }),
  'tontine.start_blocked': T({
    category: 'TONTINE',
    priority: 'HIGH',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Démarrage impossible',
      body: 'La tontine {tontine} ne peut pas démarrer : {blocages}',
    },
    en: { title: 'Cannot start', body: 'The {tontine} tontine cannot start: {blocages}' },
  }),
  'tontine.started': T({
    category: 'TONTINE',
    priority: 'HIGH',
    channels: ['SMS', 'PUSH', 'IN_APP'],
    fr: {
      title: 'La tontine démarre',
      body: 'La tontine {tontine} a démarré. Premier bénéficiaire : {beneficiaire}.',
    },
    en: {
      title: 'The tontine has started',
      body: 'The {tontine} tontine has started. First beneficiary: {beneficiaire}.',
    },
  }),
  'tontine.cycle_started': T({
    category: 'TONTINE',
    priority: 'HIGH',
    channels: ['SMS', 'PUSH', 'IN_APP'],
    fr: {
      title: 'Nouveau tour',
      body: 'Tour {numero} de {tontine} : bénéficiaire {beneficiaire}, date limite {dateLimite}.',
    },
    en: {
      title: 'New round',
      body: 'Round {numero} of {tontine}: beneficiary {beneficiaire}, deadline {dateLimite}.',
    },
  }),
  'tontine.contribution_due': T({
    category: 'TONTINE',
    priority: 'HIGH',
    channels: ['SMS', 'IN_APP'],
    fr: {
      title: 'Cotisation due',
      body: 'Votre cotisation de {montant} pour {tontine} est due le {dateLimite}.',
      sms: 'TontineMoney : votre cotisation {tontine} est due le {dateLimite}.',
    },
    en: {
      title: 'Contribution due',
      body: 'Your {montant} contribution for {tontine} is due on {dateLimite}.',
      sms: 'TontineMoney: your {tontine} contribution is due on {dateLimite}.',
    },
  }),
  'tontine.contribution_reminder': T({
    category: 'TONTINE',
    priority: 'MEDIUM',
    channels: ['SMS', 'IN_APP'],
    fr: {
      title: 'Rappel de cotisation',
      body: 'Rappel : votre cotisation de {montant} pour {tontine} est due {echeance} ({dateLimite}).',
      sms: 'TontineMoney : rappel, cotisation {tontine} due {echeance}.',
    },
    en: {
      title: 'Contribution reminder',
      body: 'Reminder: your {montant} contribution for {tontine} is due {echeance} ({dateLimite}).',
      sms: 'TontineMoney: reminder, {tontine} contribution due {echeance}.',
    },
  }),
  'tontine.contribution_received': T({
    category: 'TONTINE',
    priority: 'LOW',
    channels: ['IN_APP'],
    fr: {
      title: 'Cotisation reçue',
      body: 'Votre cotisation de {montant} pour {tontine} a été reçue.',
    },
    en: {
      title: 'Contribution received',
      body: 'Your {montant} contribution for {tontine} was received.',
    },
  }),
  'tontine.contribution_late': T({
    category: 'TONTINE',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL', 'IN_APP'],
    fr: {
      title: 'Cotisation en retard',
      body: 'Votre cotisation pour {tontine} est en retard. Une pénalité de {penalite} a été appliquée. Réglez au plus vite.',
      sms: 'TontineMoney URGENT : cotisation {tontine} en retard, pénalité appliquée. Réglez au plus vite.',
    },
    en: {
      title: 'Late contribution',
      body: 'Your contribution for {tontine} is late. A {penalite} penalty was applied. Please pay as soon as possible.',
      sms: 'TontineMoney URGENT: {tontine} contribution late, penalty applied. Please pay now.',
    },
  }),
  'tontine.contribution_defaulted': T({
    category: 'TONTINE',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL'],
    fr: {
      title: 'Défaut de cotisation',
      body: 'Votre cotisation pour {tontine} est en défaut : elle reste due.',
    },
    en: {
      title: 'Contribution defaulted',
      body: 'Your contribution for {tontine} has defaulted: it remains due.',
    },
  }),
  'tontine.member_suspended': T({
    category: 'TONTINE',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL', 'IN_APP'],
    fr: {
      title: 'Participation suspendue',
      body: 'Suite à {defauts} défauts consécutifs, votre participation à {tontine} est suspendue.',
    },
    en: {
      title: 'Participation suspended',
      body: 'After {defauts} consecutive defaults, your participation in {tontine} is suspended.',
    },
  }),
  'tontine.payout_received': T({
    category: 'TONTINE',
    priority: 'HIGH',
    channels: ['SMS', 'PUSH', 'IN_APP'],
    fr: {
      title: 'Pot reçu',
      body: 'Vous avez reçu {montant} de la tontine {tontine}.',
      sms: 'TontineMoney : vous avez reçu le pot de la tontine {tontine}. Consultez votre portefeuille.',
    },
    en: {
      title: 'Pot received',
      body: 'You received {montant} from the {tontine} tontine.',
      sms: 'TontineMoney: you received the {tontine} pot. Check your wallet.',
    },
  }),
  'tontine.cycle_completed': T({
    category: 'TONTINE',
    priority: 'MEDIUM',
    channels: ['PUSH', 'IN_APP'],
    fr: {
      title: 'Tour terminé',
      body: 'Le cycle {numero} de {tontine} est terminé, {prenom} a reçu le pot.',
    },
    en: {
      title: 'Round completed',
      body: 'Round {numero} of {tontine} is complete, {prenom} received the pot.',
    },
  }),
  'tontine.closed': T({
    category: 'TONTINE',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Tontine clôturée',
      body: 'La tontine {tontine} est terminée : chaque membre a reçu le pot. Le rapport final est disponible.',
    },
    en: {
      title: 'Tontine closed',
      body: 'The {tontine} tontine is complete: every member received the pot. The final report is available.',
    },
  }),
  'tontine.closure_blocked': T({
    category: 'TONTINE',
    priority: 'HIGH',
    channels: ['EMAIL', 'IN_APP'],
    fr: { title: 'Clôture en attente', body: 'La clôture de {tontine} est bloquée : {blocages}' },
    en: { title: 'Closure pending', body: 'Closure of {tontine} is blocked: {blocages}' },
  }),
  'tontine.paused': T({
    category: 'TONTINE',
    priority: 'HIGH',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Tontine suspendue',
      body: 'La tontine {tontine} est suspendue par l’administration de la plateforme. Motif : {motif}',
    },
    en: {
      title: 'Tontine paused',
      body: 'The {tontine} tontine has been paused by the platform. Reason: {motif}',
    },
  }),
  'tontine.resumed': T({
    category: 'TONTINE',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: { title: 'Tontine réactivée', body: 'La tontine {tontine} a repris.' },
    en: { title: 'Tontine resumed', body: 'The {tontine} tontine has resumed.' },
  }),
  'tontine.cancelled': T({
    category: 'TONTINE',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Tontine annulée',
      body: 'La tontine {tontine} a été annulée avant son démarrage. Motif : {motif}',
    },
    en: {
      title: 'Tontine cancelled',
      body: 'The {tontine} tontine was cancelled before starting. Reason: {motif}',
    },
  }),

  // --- Paiements & wallet ---
  'payment.completed': T({
    category: 'PAYMENT',
    priority: 'MEDIUM',
    channels: ['PUSH', 'IN_APP'],
    fr: { title: 'Paiement confirmé', body: 'Votre {operation} de {montant} est confirmé.' },
    en: { title: 'Payment confirmed', body: 'Your {operation} of {montant} is confirmed.' },
  }),
  'payment.failed': T({
    category: 'PAYMENT',
    priority: 'HIGH',
    channels: ['SMS', 'PUSH', 'IN_APP'],
    fr: {
      title: 'Paiement échoué',
      body: 'Votre {operation} de {montant} a échoué : {motif}.',
      sms: 'TontineMoney : votre {operation} a échoué. Détails dans l’application.',
    },
    en: {
      title: 'Payment failed',
      body: 'Your {operation} of {montant} failed: {motif}.',
      sms: 'TontineMoney: your {operation} failed. Details in the app.',
    },
  }),
  'payment.expired': T({
    category: 'PAYMENT',
    priority: 'MEDIUM',
    channels: ['IN_APP'],
    fr: {
      title: 'Paiement expiré',
      body: 'Votre {operation} de {montant} n’a pas été confirmé à temps et a expiré.',
    },
    en: {
      title: 'Payment expired',
      body: 'Your {operation} of {montant} was not confirmed in time and expired.',
    },
  }),
  'payment.refunded': T({
    category: 'PAYMENT',
    priority: 'MEDIUM',
    channels: ['EMAIL', 'IN_APP'],
    fr: { title: 'Remboursement effectué', body: 'Un remboursement de {montant} a été effectué.' },
    en: { title: 'Refund issued', body: 'A refund of {montant} has been issued.' },
  }),
  'wallet.credited': T({
    category: 'WALLET',
    priority: 'LOW',
    channels: ['IN_APP'],
    fr: {
      title: 'Portefeuille crédité',
      body: 'Votre portefeuille a été crédité de {montant} ({operation}).',
    },
    en: {
      title: 'Wallet credited',
      body: 'Your wallet was credited with {montant} ({operation}).',
    },
  }),
  'wallet.debit_failed': T({
    category: 'WALLET',
    priority: 'HIGH',
    channels: ['IN_APP', 'PUSH'],
    fr: { title: 'Débit refusé', body: 'Une opération de {montant} a été refusée : {motif}.' },
    en: { title: 'Debit declined', body: 'An operation of {montant} was declined: {motif}.' },
  }),
  'transaction.reversed': T({
    category: 'WALLET',
    priority: 'HIGH',
    channels: ['EMAIL', 'IN_APP'],
    fr: {
      title: 'Opération annulée',
      body: 'Une opération a été annulée et votre portefeuille recrédité. Motif : {motif}',
    },
    en: {
      title: 'Operation reversed',
      body: 'An operation was reversed and your wallet re-credited. Reason: {motif}',
    },
  }),

  // --- Conformité, fraude, administration ---
  'compliance.violation': T({
    category: 'ACCOUNT',
    priority: 'HIGH',
    channels: ['IN_APP', 'EMAIL'],
    fr: {
      title: 'Opération bloquée',
      body: 'Une opération a été bloquée par nos règles de conformité ({regle}).',
    },
    en: {
      title: 'Operation blocked',
      body: 'An operation was blocked by our compliance rules ({regle}).',
    },
  }),
  'fraud.flagged': T({
    category: 'SECURITY',
    priority: 'URGENT',
    channels: ['SMS', 'EMAIL'],
    fr: {
      title: 'Compte suspendu pour vérification',
      body: 'Par mesure de sécurité, votre compte est suspendu le temps d’une vérification.',
    },
    en: {
      title: 'Account suspended for review',
      body: 'For your security, your account is suspended pending a review.',
    },
  }),
  'admin.message': T({
    category: 'MESSAGE',
    priority: 'MEDIUM',
    channels: ['IN_APP', 'EMAIL'],
    fr: { title: '{sujet}', body: '{message}' },
    en: { title: '{sujet}', body: '{message}' },
  }),
  'ops.alert': T({
    category: 'ADMIN',
    priority: 'URGENT',
    channels: ['IN_APP', 'EMAIL'],
    fr: { title: 'Alerte opérationnelle', body: '{message}' },
    en: { title: 'Operational alert', body: '{message}' },
  }),
} satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];
