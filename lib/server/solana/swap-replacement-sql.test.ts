import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ARCHIVE_EXPIRED_SWAP_INTENT_SQL } from "./swap-replacement-sql.ts";

test("expired batch swap is archived and releases its unique batch slot", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE automation_jobs (id TEXT PRIMARY KEY, entity_type TEXT,
        entity_id TEXT, job_type TEXT, state TEXT, error_code TEXT, tx_hash TEXT);
      CREATE TABLE transaction_intents (id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE,
        reward_batch_id TEXT, state TEXT, error_code TEXT, updated_at TEXT,
        tx_signature TEXT UNIQUE, transaction_message_hash TEXT,
        signer_address TEXT, action TEXT);
      CREATE UNIQUE INDEX idx_reward_batch ON transaction_intents(reward_batch_id)
        WHERE reward_batch_id IS NOT NULL;
      INSERT INTO automation_jobs VALUES ('job', 'reward_swap_batch', 'batch',
        'solana_reward_purchase', 'broadcasting', 'broadcasting:solana:treasury', NULL);
      INSERT INTO transaction_intents VALUES ('old', 'automation:reward:batch:batch',
        'batch', 'prepared', NULL, NULL, 'old-sig', 'hash', 'treasury',
        'solana_reward_purchase_automation');
    `);
    const args = ["automation:reward:batch:batch", "old-sig", "hash", "treasury",
      "solana_reward_purchase_automation", "job", "reward_swap_batch", "batch",
      "solana_reward_purchase", "broadcasting:solana:treasury"];
    assert.equal(db.prepare(ARCHIVE_EXPIRED_SWAP_INTENT_SQL).run(
      ...args.slice(0, 9), "wrong-fence").changes, 0);
    assert.equal(db.prepare(ARCHIVE_EXPIRED_SWAP_INTENT_SQL).run(...args).changes, 1);
    db.prepare(`INSERT INTO transaction_intents (id,idempotency_key,reward_batch_id)
      VALUES ('new','automation:reward:batch:batch','batch')`).run();
    assert.deepEqual(db.prepare("SELECT id,state,reward_batch_id FROM transaction_intents ORDER BY id")
      .all().map((row) => ({ ...row })), [
        { id: "new", state: null, reward_batch_id: "batch" },
        { id: "old", state: "expired", reward_batch_id: null },
      ]);
  } finally { db.close(); }
});
