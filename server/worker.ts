import { setTimeout as delay } from 'node:timers/promises';
import { loadWorkerConfig } from './config.js';
import { createPostgresPool } from './infrastructure/postgres.js';
import { PostgresProductionStore } from './infrastructure/postgresProductionStore.js';
import { DeterministicMockFollowUpDispatcher, FollowUpWorker } from './jobs/followUpWorker.js';

const config = loadWorkerConfig();
const pool = createPostgresPool(config.DATABASE_URL);
const store = new PostgresProductionStore(pool);
const dispatcher = new DeterministicMockFollowUpDispatcher();
const worker = new FollowUpWorker(store, dispatcher, { leaseMilliseconds: config.WORKER_LEASE_MS });
const controller = new AbortController();
let stopping = false;

const stop = async () => {
  if (stopping) return;
  stopping = true;
  controller.abort();
  await pool.end();
};

process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

while (!controller.signal.aborted) {
  try {
    await worker.runOnce();
  } catch {
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'follow_up_worker_cycle_failed' })}\n`);
  }
  try {
    await delay(config.WORKER_POLL_INTERVAL_MS, undefined, { signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
}
