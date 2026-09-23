import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ASSERT_ONE_ROW_CHANGED_SQL } from "../../protocol/automation-safety.ts";
import { UPDATE_SOLANA_VAULT_FENCE_SQL } from "./vault-fence.ts";

test("one mint-wide fence serializes credits from separate launch vaults", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE service_cursors (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
      CREATE TABLE reward_vaults (launch_id TEXT PRIMARY KEY, inventory_atomic TEXT);
      INSERT INTO service_cursors VALUES ('solana-vault-fence:treasury:mint','0',NULL);
      INSERT INTO reward_vaults VALUES ('launch-a','0'),('launch-b','0');
    `);
    const key = "solana-vault-fence:treasury:mint";
    const commit = (launch: string, next: string, expectedFence: string) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(UPDATE_SOLANA_VAULT_FENCE_SQL).run(key, expectedFence, next);
        db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
        db.prepare("UPDATE reward_vaults SET inventory_atomic='1' WHERE launch_id=?").run(launch);
        db.prepare(ASSERT_ONE_ROW_CHANGED_SQL).get();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    };
    commit("launch-a", "1", "0");
    assert.throws(() => commit("launch-b", "2", "0"));
    assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults WHERE launch_id='launch-b'")
      .get()?.inventory_atomic, "0");
    commit("launch-b", "2", "1");
    assert.equal(db.prepare("SELECT inventory_atomic FROM reward_vaults WHERE launch_id='launch-b'")
      .get()?.inventory_atomic, "1");
  } finally { db.close(); }
});
