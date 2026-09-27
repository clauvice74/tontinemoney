#!/usr/bin/env node
// Instantanés d'état publiés par déclencheurs (extraction, étape 6, A-54).
//
// Chaque domaine publie l'état de ses entités de référence sous forme d'événements
// `<entité>.snapshot` (ou `.recorded` pour les tables en ajout seul), écrits dans l'outbox
// par un déclencheur PostgreSQL dans la MÊME transaction que l'écriture : aucune modification
// n'échappe à la publication (SQL brut, updateMany), et les consommateurs (reporting, projections)
// ne lisent jamais les tables du domaine. Colonnes publiées explicitement : aucune donnée
// personnelle (noms, contacts, documents), montants en texte (bigint exact).
//
//   node scripts/cdc-snapshots.mjs --print     SQL des fonctions et déclencheurs
//   node scripts/cdc-snapshots.mjs --backfill  SQL de publication de l'état existant
//   node scripts/cdc-snapshots.mjs --republish exécute ce SQL sur DATABASE_URL : reconstruction
//                                               des projections (idempotent, versions ordonnées)
//
// Ce fichier est la source de vérité : toute modification passe par une nouvelle migration
// contenant la sortie de --print (CREATE OR REPLACE, idempotent).

/** Types de colonnes → expression JSON. */
const EXPR = {
  id: (c) => `r.${c}`,
  text: (c) => `r.${c}`,
  enum: (c) => `r.${c}::text`,
  int: (c) => `r.${c}`,
  bool: (c) => `r.${c}`,
  bigint: (c) => `r.${c}::text`,
  ts: (c) => `platform.cdc_iso(r.${c})`,
  date: (c) => `to_char(r.${c}, 'YYYY-MM-DD')`,
};

/** [schéma, table, suffixe de fonction, événement, producteur, type d'agrégat, colonnes, ajout seul] */
export const SNAPSHOTS = [
  {
    schema: 'tontines',
    table: 'ton_tontines',
    event: 'tontine.snapshot',
    producer: 'tontines',
    aggregate: 'tontine',
    columns: {
      name: 'text',
      status: 'enum',
      currency: 'text',
      frequency: 'enum',
      contributionMinor: 'bigint',
      totalCycles: 'int',
      reserveWalletId: 'id',
      drawProof: 'text',
      createdAt: 'ts',
      startedAt: 'ts',
      completedAt: 'ts',
      archivedUntil: 'ts',
    },
  },
  {
    schema: 'tontines',
    table: 'ton_cycles',
    event: 'tontine.cycle.snapshot',
    producer: 'tontines',
    aggregate: 'tontine-cycle',
    columns: {
      tontineId: 'id',
      number: 'int',
      status: 'enum',
      beneficiaryId: 'id',
      dueDate: 'date',
      expectedMinor: 'bigint',
      collectedMinor: 'bigint',
      payoutMinor: 'bigint',
      partialPayout: 'bool',
      completedAt: 'ts',
    },
  },
  {
    schema: 'tontines',
    table: 'ton_contributions',
    event: 'tontine.contribution.snapshot',
    producer: 'tontines',
    aggregate: 'contribution',
    columns: {
      tontineId: 'id',
      cycleId: 'id',
      memberId: 'id',
      status: 'enum',
      amountMinor: 'bigint',
      penaltyMinor: 'bigint',
      penaltyPaid: 'bool',
      dueDate: 'date',
      paidAt: 'ts',
    },
  },
  {
    schema: 'tontines',
    table: 'ton_members',
    event: 'tontine.membership.snapshot',
    producer: 'tontines',
    aggregate: 'tontine-membership',
    columns: {
      tontineId: 'id',
      memberId: 'id',
      role: 'enum',
      status: 'enum',
      position: 'int',
      joinedAt: 'ts',
    },
  },
  {
    schema: 'wallets',
    table: 'wal_wallets',
    event: 'wallet.snapshot',
    producer: 'wallets',
    aggregate: 'wallet',
    columns: {
      ownerType: 'enum',
      status: 'enum',
      currency: 'text',
      balanceMinor: 'bigint',
      blockedMinor: 'bigint',
    },
  },
  {
    schema: 'wallets',
    table: 'wal_movements',
    event: 'wallet.movement.recorded',
    producer: 'wallets',
    aggregate: 'wallet-movement',
    appendOnly: true,
    columns: { walletId: 'id', type: 'enum', amountMinor: 'bigint', createdAt: 'ts' },
  },
  {
    schema: 'transactions',
    table: 'trx_transactions',
    event: 'transaction.snapshot',
    producer: 'transactions',
    aggregate: 'transaction',
    columns: {
      type: 'enum',
      status: 'enum',
      currency: 'text',
      amountMinor: 'bigint',
      createdAt: 'ts',
      completedAt: 'ts',
    },
  },
  {
    schema: 'transactions',
    table: 'trx_reconciliation_reports',
    event: 'reconciliation.report.snapshot',
    producer: 'transactions',
    aggregate: 'reconciliation-report',
    columns: {
      kind: 'enum',
      businessDate: 'date',
      status: 'text',
      discrepancyCount: 'int',
      alert: 'bool',
      createdAt: 'ts',
    },
  },
  {
    schema: 'payments',
    table: 'pay_payments',
    event: 'payment.snapshot',
    producer: 'payments',
    aggregate: 'payment',
    columns: {
      type: 'enum',
      status: 'enum',
      currency: 'text',
      amountMinor: 'bigint',
      feeMinor: 'bigint',
      transactionId: 'id',
      createdAt: 'ts',
      completedAt: 'ts',
    },
  },
  {
    schema: 'members',
    table: 'mbr_members',
    event: 'member.snapshot',
    producer: 'members',
    aggregate: 'member',
    columns: { status: 'enum', kycLevel: 'enum' },
  },
  {
    schema: 'kyc',
    table: 'kyc_requests',
    event: 'kyc.request.snapshot',
    producer: 'kyc',
    aggregate: 'kyc-request',
    columns: { status: 'enum', submittedAt: 'ts' },
  },
  {
    schema: 'kyc',
    table: 'kyc_aml_matches',
    event: 'kyc.aml.match.snapshot',
    producer: 'kyc',
    aggregate: 'aml-match',
    columns: { listName: 'text', status: 'enum', createdAt: 'ts' },
  },
  {
    schema: 'compliance',
    table: 'cmp_violations',
    event: 'compliance.violation.recorded',
    producer: 'compliance',
    aggregate: 'compliance-violation',
    appendOnly: true,
    columns: { ruleCode: 'text', action: 'enum', operationType: 'enum', createdAt: 'ts' },
  },
  {
    schema: 'compliance',
    table: 'cmp_cases',
    event: 'compliance.case.snapshot',
    producer: 'compliance',
    aggregate: 'compliance-case',
    columns: {
      type: 'enum',
      status: 'enum',
      severity: 'enum',
      outcome: 'enum',
      assigneeId: 'id',
      openedAt: 'ts',
      closedAt: 'ts',
    },
  },
];

const q = (c) => `"${c}"`;

function payload(s) {
  const pairs = [`'id', r.id`];
  for (const [k, kind] of Object.entries(s.columns)) pairs.push(`'${k}', ${EXPR[kind](q(k))}`);
  return `jsonb_build_object(${pairs.join(', ')})`;
}

const fnName = (s) => `${q(s.schema)}.cdc_${s.table}`;

export function cdcSql() {
  const out = [
    `-- Généré par packages/database/scripts/cdc-snapshots.mjs --print — ne pas modifier à la main`,
    `CREATE OR REPLACE FUNCTION platform.cdc_iso(ts timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;`,
    `CREATE OR REPLACE FUNCTION platform.cdc_emit(
  p_type text, p_producer text, p_aggregate text, p_id text, p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO platform.outbox_events
    ("id", "eventType", "eventVersion", "aggregateType", "aggregateId", "producer",
     "correlationId", "payload", "occurredAt")
  VALUES (
    gen_random_uuid(), p_type, 1, p_aggregate, p_id, p_producer,
    coalesce(nullif(current_setting('app.correlation_id', true), ''), 'cdc'),
    p_payload || jsonb_build_object(
      'capturedAt', platform.cdc_iso(v_now),
      -- Ordre des instantanés d'une même ligne (microsecondes, monotone sous verrou de ligne)
      'sourceVersion', ((extract(epoch FROM v_now) * 1000000)::bigint)::text
    ),
    v_now
  );
END $$;`,
  ];
  for (const s of SNAPSHOTS) {
    const body = s.appendOnly
      ? `BEGIN
  r := NEW;
  PERFORM platform.cdc_emit('${s.event}', '${s.producer}', '${s.aggregate}', r.id::text,
    ${payload(s)});
  RETURN NULL;
END`
      : `DECLARE
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := ${payload(s)} || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := ${payload(s)} || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := ${payload(s)} || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('${s.event}', '${s.producer}', '${s.aggregate}', r.id::text, v_new);
  RETURN NULL;
END`;
    out.push(`CREATE OR REPLACE FUNCTION ${fnName(s)}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r ${q(s.schema)}.${q(s.table)}%ROWTYPE;
${body.replace(/^DECLARE\n/, '')} $$;`);
    out.push(`DROP TRIGGER IF EXISTS cdc_snapshot ON ${q(s.schema)}.${q(s.table)};`);
    out.push(`CREATE TRIGGER cdc_snapshot AFTER INSERT${
      s.appendOnly ? '' : ' OR UPDATE OR DELETE'
    } ON ${q(s.schema)}.${q(s.table)}
  FOR EACH ROW EXECUTE FUNCTION ${fnName(s)}();`);
  }
  return out.join('\n\n') + '\n';
}

/** Publication de l'état existant (initialisation des projections). */
export function backfillSql() {
  const out = ['-- Initialisation des projections : un instantané par ligne existante'];
  for (const s of SNAPSHOTS) {
    const extra = s.appendOnly ? '' : ` || '{"deleted": false}'::jsonb`;
    out.push(`SELECT platform.cdc_emit('${s.event}', '${s.producer}', '${s.aggregate}', r.id::text,
  ${payload(s)}${extra})
FROM ${q(s.schema)}.${q(s.table)} r;`);
  }
  return out.join('\n\n') + '\n';
}

if (process.argv.includes('--print')) process.stdout.write(cdcSql());
if (process.argv.includes('--backfill')) process.stdout.write(backfillSql());
if (process.argv.includes('--republish')) {
  const { default: pg } = await import('pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL absent');
  const client = new pg.Client({ connectionString: url.replace(/\?schema=[^&]*/, '') });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(backfillSql());
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM platform.outbox_events WHERE "status" = 'PENDING'`,
    );
    await client.query('COMMIT');
    console.log(`✔ Instantanés republiés (${rows[0].n} événements en attente de relais)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}
