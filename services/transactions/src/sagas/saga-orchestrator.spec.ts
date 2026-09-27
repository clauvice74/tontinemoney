import { describe, expect, it } from 'vitest';
import { canTransition } from './saga-orchestrator';

describe('Machine à états des sagas (A-53)', () => {
  it('STARTED : étape intermédiaire ou fin (succès, échec, compensation)', () => {
    for (const to of ['STARTED', 'COMPLETED', 'FAILED', 'COMPENSATED'] as const)
      expect(canTransition('STARTED', to)).toBe(true);
  });

  it('états terminaux : aucune transition', () => {
    for (const from of ['COMPLETED', 'FAILED', 'COMPENSATED'] as const)
      for (const to of ['STARTED', 'COMPLETED', 'FAILED', 'COMPENSATED'] as const)
        expect(canTransition(from, to)).toBe(false);
  });
});
