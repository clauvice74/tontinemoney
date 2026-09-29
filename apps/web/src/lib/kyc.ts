const KYC_ORDER = ['NONE', 'TIER_1', 'TIER_2', 'TIER_3'];

/** Vrai si le niveau KYC atteint au moins `min` (ex. TIER_2 pour un retrait). */
export function kycAtLeast(level: string | null | undefined, min: string): boolean {
  return KYC_ORDER.indexOf(level ?? 'NONE') >= KYC_ORDER.indexOf(min);
}
