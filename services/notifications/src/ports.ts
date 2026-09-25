import { type PlatformRole } from '@tontine/contracts';
import { type QuietHours } from './quiet-hours';

/** Profil de communication d'un destinataire (fourni par le domaine Membres). */
export interface RecipientProfile {
  id: string;
  firstName: string;
  email: string | null;
  phone: string | null;
  language: string;
  timezone: string;
  country: string | null;
  preferredChannel: 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';
  enabledTypes: string[];
  quietHours: QuietHours | null;
}

export interface RecipientDirectory {
  getMany(ids: string[]): Promise<RecipientProfile[]>;
}

/** Annuaire des rôles plateforme (fourni par le domaine Auth). */
export interface RoleDirectory {
  userIdsWithRole(role: PlatformRole): Promise<string[]>;
}

export const RECIPIENT_DIRECTORY = Symbol('RECIPIENT_DIRECTORY');
export const ROLE_DIRECTORY = Symbol('ROLE_DIRECTORY');

/** Annuaire des tontines : port partagé TontineAccessPort (packages/platform). */
export {
  TONTINE_ACCESS as TONTINE_DIRECTORY,
  type TontineAccessPort as TontineDirectory,
} from '@tontine/platform';
