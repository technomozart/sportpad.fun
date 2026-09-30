import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getAddress } from "viem";
import {
  ARM_CHILIZ_BRIDGE_POLICY_SQL, INSERT_PAUSED_CHILIZ_BRIDGE_POLICY_SQL,
  INSERT_PREPARED_CHILIZ_BRIDGE_SQL, MARK_CHILIZ_BRIDGE_BROADCAST_SQL,
  RESERVE_CHILIZ_BRIDGE_POLICY_SQL,
} from "./chiliz-bridge-journal.ts";
import { INSERT_CHILIZ_BRIDGE_CANARY_PLAN_SQL } from
  "../../app/api/internal/workers/chiliz-bridge/core.ts";

const destination = "0x42c40359da463b480c3dc9e7a4d9c1ac2ef45c21";
const source = Keypair.fromSeed(new Uint8Array(32).fill(57)).publicKey.toBase58();
const nowMs = 1_800_000_000_000;
const quoteHash = "a".repeat(64);
const signature = bs58.encode(new Uint8Array(64).fill(7));

function fullMigrationDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const names = readdirSync(new URL("../../drizzle/", import.meta.url))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 34)
    .sort();
  assert.equal(names.length, 35);
  for (const name of names) {
    const migration = readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  return db;
}

test("0000–0034 plans are immutable and required before a one-shot send", () => {
  const db = fullMigrationDatabase();
  try {
    db.prepare(INSERT_PAUSED_CHILIZ_BRIDGE_POLICY_SQL)
      .run(source, destination, "1000000000");
    assert.equal(db.prepare(ARM_CHILIZ_BRIDGE_POLICY_SQL).run().changes, 1);
    const signedBytes = Buffer.alloc(120, 1).toString("base64");
    const signedHash = createHash("sha256").update(Buffer.from(signedBytes, "base64"))
      .digest("hex");
    assert.equal(db.prepare(INSERT_PREPARED_CHILIZ_BRIDGE_SQL).run(
      "initial", source, destination, "700000000", "6650000000000000000",
      `oft:${quoteHash}`, nowMs + 60_000, "OFT", signedBytes,
      signedHash, signature, nowMs,
    ).changes, 1);
    assert.equal(db.prepare(RESERVE_CHILIZ_BRIDGE_POLICY_SQL).run("initial").changes, 1);
    assert.throws(() => db.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .run("initial", signature, nowMs), /chiliz_bridge_canary_plan_missing/);
    const plan = {
      sourceWallet: source, destinationTreasury: getAddress(destination),
      sourceAmountAtomic: "700000000", minimumDestinationWei: "6650000000000000000",
      onchainQuoteDigestSha256: quoteHash, quoteExpiresAtMs: nowMs + 60_000,
      expectedMessageSha256: "b".repeat(64),
    };
    const wrong = JSON.stringify({ ...plan, sourceWallet: Keypair.generate().publicKey.toBase58() });
    assert.throws(() => db.prepare(INSERT_CHILIZ_BRIDGE_CANARY_PLAN_SQL)
      .run("initial", wrong, createHash("sha256").update(wrong).digest("hex")),
    /chiliz_bridge_canary_plan_identity_invalid/);
    const json = JSON.stringify(plan);
    const sha = createHash("sha256").update(json).digest("hex");
    assert.equal(db.prepare(INSERT_CHILIZ_BRIDGE_CANARY_PLAN_SQL)
      .run("initial", json, sha).changes, 1);
    assert.throws(() => db.exec("UPDATE chiliz_bridge_canary_plans SET plan_sha256='" +
      "c".repeat(64) + "'"), /chiliz_bridge_canary_plan_immutable/);
    assert.throws(() => db.exec("DELETE FROM chiliz_bridge_canary_plans"),
      /chiliz_bridge_canary_plan_immutable/);
    assert.equal(db.prepare(MARK_CHILIZ_BRIDGE_BROADCAST_SQL)
      .run("initial", signature, nowMs).changes, 1);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});
