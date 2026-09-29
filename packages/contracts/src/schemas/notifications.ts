import { z } from 'zod';
import { type NotificationCategory } from '../enums';

/**
 * Filtres de la liste des notifications (A-60) : regroupements lisibles pour le membre,
 * traduits côté API en catégories et, pour les rappels, en modèles de message.
 */
export const NOTIFICATION_FILTERS = [
  'PAYMENT',
  'REMINDER',
  'SYSTEM',
  'KYC',
  'WALLET',
  'TONTINE',
] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const NOTIFICATION_FILTER_CATEGORIES: Record<
  Exclude<NotificationFilter, 'REMINDER'>,
  NotificationCategory[]
> = {
  PAYMENT: ['PAYMENT'],
  SYSTEM: ['SECURITY', 'ACCOUNT', 'ADMIN', 'MESSAGE'],
  KYC: ['KYC'],
  WALLET: ['WALLET'],
  TONTINE: ['TONTINE'],
};

/** Modèles de message considérés comme des rappels (échéances, retards, KYC à faire). */
export const REMINDER_TEMPLATES = [
  'tontine.contribution_due',
  'tontine.contribution_reminder',
  'tontine.contribution_late',
  'member.kyc_required',
] as const;

export const notificationFilterSchema = z.enum(NOTIFICATION_FILTERS);
