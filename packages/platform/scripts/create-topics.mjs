#!/usr/bin/env node
// Crée les topics Kafka / Redpanda de tous les événements du catalogue (étape 3, A-52) :
// `<type>.v<version>` + topic des messages rejetés. Idempotent (topics existants conservés).
//
//   KAFKA_BROKERS=localhost:19092 node scripts/create-topics.mjs [--dry-run]
//
// Options : KAFKA_TOPIC_PARTITIONS (3), KAFKA_REPLICATION_FACTOR (1),
// rétention 7 jours (événements) et 30 jours (rejets, le temps d'analyser et de rejouer).
import { DEAD_LETTER_TOPIC, EVENT_CATALOG, topicFor } from '@tontine/events';
import { Kafka, logLevel } from 'kafkajs';

const DAY = 86_400_000;
const partitions = Number(process.env.KAFKA_TOPIC_PARTITIONS ?? 3);
const replicationFactor = Number(process.env.KAFKA_REPLICATION_FACTOR ?? 1);
const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:19092').split(',').map((b) => b.trim());

const topics = [
  ...Object.entries(EVENT_CATALOG).map(([type, def]) => ({
    topic: topicFor(type, def.version),
    numPartitions: partitions,
    replicationFactor,
    configEntries: [{ name: 'retention.ms', value: String(7 * DAY) }],
  })),
  {
    topic: DEAD_LETTER_TOPIC,
    numPartitions: 1,
    replicationFactor,
    configEntries: [{ name: 'retention.ms', value: String(30 * DAY) }],
  },
];

if (process.argv.includes('--dry-run')) {
  for (const t of topics) console.log(`${t.topic}  (partitions=${t.numPartitions})`);
  console.log(`${topics.length} topics`);
  process.exit(0);
}

const admin = new Kafka({
  clientId: 'tontinemoney-topics',
  brokers,
  logLevel: logLevel.WARN,
}).admin();
try {
  await admin.connect();
  const existing = new Set(await admin.listTopics());
  const missing = topics.filter((t) => !existing.has(t.topic));
  if (missing.length) await admin.createTopics({ topics: missing, waitForLeaders: true });
  console.log(
    `✔ ${missing.length} topic(s) créé(s), ${topics.length - missing.length} déjà présent(s) (${brokers.join(',')})`,
  );
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await admin.disconnect();
}
