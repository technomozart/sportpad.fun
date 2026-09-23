import assert from "node:assert/strict";
import test from "node:test";

import { evaluateClaimReadinessByChain } from "./claim-readiness.ts";
import type { AutomationHeartbeat } from "./launch-automation-gate.ts";

const nowMs = Date.parse("2026-09-23T12:00:30Z");
const solanaTreasury = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const chilizTreasury = `0x${"a".repeat(40)}`;

function heartbeat(key: string, jobTypes: string[], updated_at = "2026-09-23 12:00:00"): AutomationHeartbeat {
  return { key, value: JSON.stringify({ jobTypes }), updated_at };
}

const solanaHeartbeat = heartbeat(`automation:solana:${solanaTreasury}`, ["solana_claim_payout"]);
const verified = {
  configuredClaims: { ready: false, missing: ["reward vault signer"] },
  heartbeats: [solanaHeartbeat],
  solanaRewardTreasury: solanaTreasury,
  chilizTreasury,
  financialLedgerVerified: true,
  solanaPayoutVerified: true,
  chilizMigrationVerified: false,
  nowMs,
};

test("a verified Solana claim lane does not depend on Chiliz worker or migration", () => {
  const readiness = evaluateClaimReadinessByChain(verified);
  assert.deepEqual(readiness.solana, { ready: true, missing: [] });
  assert.equal(readiness.chiliz.ready, false);
  assert.ok(readiness.chiliz.missing.includes("Chiliz V2 execution verification"));
  assert.ok(readiness.chiliz.missing.includes("active Chiliz reward claim worker"));
});

test("each claim lane needs its own exact, fresh payout capability", () => {
  const withoutSolana = evaluateClaimReadinessByChain({ ...verified, heartbeats: [
    heartbeat(`automation:solana:${solanaTreasury}`, ["solana_reward_purchase"]),
    heartbeat(`automation:chiliz:${chilizTreasury}`, ["chiliz_claim_unwrap"]),
  ], chilizMigrationVerified: true });
  assert.equal(withoutSolana.solana.ready, false);
  assert.deepEqual(withoutSolana.chiliz, { ready: true, missing: [] });

  for (const bad of [
    heartbeat(`automation:solana:${solanaTreasury}`, ["solana_claim_payout"], "2026-09-23 11:58:00"),
    heartbeat("automation:solana:wrong-treasury", ["solana_claim_payout"]),
    { ...solanaHeartbeat, value: "not-json" },
  ]) {
    assert.ok(evaluateClaimReadinessByChain({ ...verified, heartbeats: [bad] }).solana.missing
      .includes("active Solana reward payout worker"));
  }
});

test("financial, payout-canary, and configured pause holds remain fail closed", () => {
  const locked = evaluateClaimReadinessByChain({
    ...verified,
    financialLedgerVerified: false,
    solanaPayoutVerified: false,
    configuredClaims: { ready: false, missing: ["reward vault signer", "reward pause lifted", "claim worker approval"] },
  });
  assert.equal(locked.solana.ready, false);
  assert.ok(locked.solana.missing.includes("financial-ledger verification"));
  assert.ok(locked.solana.missing.includes("Solana claim payout canary verification"));
  assert.ok(locked.solana.missing.includes("reward pause lifted"));
  assert.ok(locked.solana.missing.includes("claim worker approval"));
});
