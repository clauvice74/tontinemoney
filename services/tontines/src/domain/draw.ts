import { createHash, randomBytes } from 'node:crypto';

/**
 * Tirage de l'ordre de passage (US-4.3 §4, US-4.6 §6) : Fisher-Yates alimenté par un flux
 * déterministe SHA-256(seed ‖ compteur) — la graine `crypto.randomBytes(32)` est conservée,
 * ce qui rend le tirage vérifiable a posteriori ; la preuve est un hash SHA-256 horodaté.
 */
export const DRAW_ALGORITHM = 'fisher-yates/sha256-ctr/v1';

export interface DrawResult {
  order: string[];
  seedHex: string;
  seedHash: string;
  proof: string;
  drawnAt: string;
  algorithm: string;
}

class SeededStream {
  private counter = 0;
  private buffer = Buffer.alloc(0);

  constructor(private readonly seed: Buffer) {}

  private next32(): number {
    if (this.buffer.length < 4) {
      const block = createHash('sha256').update(this.seed).update(String(this.counter++)).digest();
      this.buffer = Buffer.concat([this.buffer, block]);
    }
    const v = this.buffer.readUInt32BE(0);
    this.buffer = this.buffer.subarray(4);
    return v;
  }

  /** Entier uniforme dans [0, n) par échantillonnage avec rejet (pas de biais modulo). */
  below(n: number): number {
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const v = this.next32();
      if (v < limit) return v % n;
    }
  }
}

export function shuffle(items: readonly string[], seed: Buffer): string[] {
  const out = [...items];
  const rng = new SeededStream(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.below(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function drawProof(
  tontineId: string,
  order: readonly string[],
  seedHex: string,
  drawnAt: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ tontineId, order, seed: seedHex, drawnAt, algorithm: DRAW_ALGORITHM }))
    .digest('hex');
}

export function draw(
  tontineId: string,
  memberIds: readonly string[],
  drawnAt: Date,
  seed: Buffer = randomBytes(32),
): DrawResult {
  // Entrée canonique (tri) : le résultat ne dépend que de la graine, pas de l'ordre de lecture en base.
  const canonical = [...memberIds].sort();
  const order = shuffle(canonical, seed);
  const seedHex = seed.toString('hex');
  const at = drawnAt.toISOString();
  return {
    order,
    seedHex,
    seedHash: createHash('sha256').update(seed).digest('hex'),
    proof: drawProof(tontineId, order, seedHex, at),
    drawnAt: at,
    algorithm: DRAW_ALGORITHM,
  };
}

/** Vérification indépendante d'un tirage publié. */
export function verifyDraw(
  tontineId: string,
  memberIds: readonly string[],
  result: Pick<DrawResult, 'order' | 'seedHex' | 'proof' | 'drawnAt'>,
): boolean {
  const recomputed = shuffle([...memberIds].sort(), Buffer.from(result.seedHex, 'hex'));
  return (
    recomputed.join(',') === result.order.join(',') &&
    drawProof(tontineId, result.order, result.seedHex, result.drawnAt) === result.proof
  );
}

/** Hash horodaté d'une désignation de bénéficiaire (non-répudiation, US-4.6 §6). */
export function beneficiaryProof(
  tontineId: string,
  cycleNumber: number,
  beneficiaryId: string,
  mode: string,
  at: Date,
  extra = '',
): string {
  return createHash('sha256')
    .update(`${tontineId}|${cycleNumber}|${beneficiaryId}|${mode}|${at.toISOString()}|${extra}`)
    .digest('hex');
}
