import type { TontineView } from './api/types';

/** A-61 : configuration modifiable avant démarrage, tant qu'aucun autre membre n'a rejoint. */
export function isEditable(x: Pick<TontineView, 'status' | 'memberCount'>): boolean {
  return (x.status === 'DRAFT' || x.status === 'READY') && x.memberCount <= 1;
}
