import { Injectable } from '@nestjs/common';

export interface FraudScoreInput {
  memberId: string | null;
  type: string;
  amountMinor: bigint;
  currency: string;
}

/** Port de scoring fraude (A-14 : service Fraude non spécifié en V1). */
export abstract class FraudScoringPort {
  /** Score ≥ seuil → transaction REJECTED (R-TRX-03). */
  readonly threshold: number = 80;
  abstract score(input: FraudScoreInput): Promise<{ score: number; reason: string }>;
}

/**
 * Scoring simulé déterministe : montant unitaire anormalement élevé (≥ 50 000 000 unités mineures,
 * soit 50 M XAF ou 500 000 EUR) → score 95. Toute autre opération → 0.
 */
@Injectable()
export class SimulatedFraudScoring extends FraudScoringPort {
  async score(input: FraudScoreInput): Promise<{ score: number; reason: string }> {
    if (input.amountMinor >= 50_000_000n) return { score: 95, reason: 'montant inhabituel' };
    return { score: 0, reason: 'aucun signal' };
  }
}
