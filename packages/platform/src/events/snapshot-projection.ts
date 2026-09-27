import { isUniqueViolation } from '@tontine/database';

/** Opérations des délégués Prisma utilisées par une projection d'instantanés. */
export interface ProjectionDelegate {
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
  create(args: { data: object }): Promise<unknown>;
  deleteMany(args: { where: object }): Promise<{ count: number }>;
}

export interface SnapshotFields {
  /** Montants (texte → bigint exact). */
  bigint?: readonly string[];
  /** Horodatages ISO et dates `AAAA-MM-JJ` → Date. */
  dates?: readonly string[];
  /** Champs de l'instantané recopiés ; tous les champs métier par défaut. */
  pick?: readonly string[];
}

/** Champs techniques d'un instantané, jamais recopiés tels quels. */
const TECHNICAL = new Set(['id', 'deleted', 'capturedAt', 'sourceVersion']);

/** Conversion d'un instantané (`*.snapshot` / `*.recorded`, A-54) en ligne de projection. */
export function snapshotRow(
  fields: SnapshotFields,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (TECHNICAL.has(k) || (fields.pick && !fields.pick.includes(k))) continue;
    if (v === null || v === undefined) row[k] = null;
    else if (fields.bigint?.includes(k)) row[k] = BigInt(v as string);
    else if (fields.dates?.includes(k))
      row[k] = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v as string) ? `${v}T00:00:00Z` : (v as string));
    else row[k] = v;
  }
  return row;
}

/**
 * Applique un instantané d'état à une projection (A-54) : idempotent et insensible au désordre —
 * une ligne n'est remplacée que par un instantané de version supérieure ou égale, une suppression
 * n'efface qu'un état plus ancien. La table porte `id` et `sourceVersion`.
 */
export async function applySnapshot(
  delegate: ProjectionDelegate,
  fields: SnapshotFields,
  payload: Record<string, unknown>,
): Promise<void> {
  const id = payload['id'] as string;
  const version = BigInt(payload['sourceVersion'] as string);
  if (payload['deleted'] === true) {
    await delegate.deleteMany({ where: { id, sourceVersion: { lte: version } } });
    return;
  }
  const row = snapshotRow(fields, payload);
  const updated = await delegate.updateMany({
    where: { id, sourceVersion: { lte: version } },
    data: { ...row, sourceVersion: version },
  });
  if (updated.count > 0) return;
  try {
    await delegate.create({ data: { id, ...row, sourceVersion: version } });
  } catch (e) {
    // Ligne déjà présente avec un instantané plus récent : celui-ci est périmé
    if (!isUniqueViolation(e)) throw e;
  }
}

/** Fait en ajout seul (`*.recorded`) : inséré une fois, redélivrance ignorée. */
export async function applyRecorded(
  delegate: ProjectionDelegate,
  fields: SnapshotFields,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await delegate.create({ data: { id: payload['id'], ...snapshotRow(fields, payload) } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}
