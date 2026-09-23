import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { UPSERT_EVM_WALLET_LINK_SQL } from "./evm-wallet-auth.ts";

test("EVM link migration preserves existing links and upserts only the verified holder wallet", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE evm_wallet_links (
        owner_user_id TEXT PRIMARY KEY NOT NULL,
        solana_wallet TEXT NOT NULL,
        evm_address TEXT NOT NULL,
        chain_id INTEGER DEFAULT 88888 NOT NULL,
        verified_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_evm_links_address ON evm_wallet_links(evm_address);
      CREATE INDEX idx_evm_links_solana_wallet ON evm_wallet_links(solana_wallet);
      INSERT INTO evm_wallet_links VALUES
        ('user-a', 'sol-a', '0xaaa', 88888, 100, 100),
        ('user-b', 'sol-c', '0xbbb', 88888, 200, 200);
    `);
    const migration = readFileSync(new URL("../../drizzle/0017_milky_dracula.sql", import.meta.url), "utf8");
    db.exec("BEGIN IMMEDIATE");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
    db.exec("COMMIT");

    const rows = () => db.prepare(`
      SELECT owner_user_id, solana_wallet, evm_address, verified_at
      FROM evm_wallet_links ORDER BY owner_user_id, solana_wallet
    `).all().map((row) => ({ ...row }));
    assert.deepEqual(rows(), [
      { owner_user_id: "user-a", solana_wallet: "sol-a", evm_address: "0xaaa", verified_at: 100 },
      { owner_user_id: "user-b", solana_wallet: "sol-c", evm_address: "0xbbb", verified_at: 200 },
    ]);

    const upsert = db.prepare(UPSERT_EVM_WALLET_LINK_SQL);
    upsert.run("user-a", "sol-b", "0xaaa", 300);
    upsert.run("user-b", "sol-d", "0xaaa", 400);
    assert.equal(rows().length, 4);
    upsert.run("user-a", "sol-b", "0xbbb", 500);

    assert.deepEqual(rows(), [
      { owner_user_id: "user-a", solana_wallet: "sol-a", evm_address: "0xaaa", verified_at: 100 },
      { owner_user_id: "user-a", solana_wallet: "sol-b", evm_address: "0xbbb", verified_at: 500 },
      { owner_user_id: "user-b", solana_wallet: "sol-c", evm_address: "0xbbb", verified_at: 200 },
      { owner_user_id: "user-b", solana_wallet: "sol-d", evm_address: "0xaaa", verified_at: 400 },
    ]);
    assert.equal(db.prepare(`SELECT evm_address FROM evm_wallet_links WHERE owner_user_id = ?1 AND solana_wallet = ?2`)
      .get("user-a", "sol-a")?.evm_address, "0xaaa");
  } finally {
    db.close();
  }
});
