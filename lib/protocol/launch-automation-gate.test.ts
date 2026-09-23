import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLaunchAutomationReadiness, type AutomationHeartbeat, type MaintenanceRun } from "./launch-automation-gate.ts";

const now = Date.parse("2026-09-23T12:00:30Z");
const buybackTreasury = "CtubJkSzXezmwrX2W67HZkkCiQKCk9oFWHK5K6tdV4yQ";
const rewardTreasury = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const chilizWallet = `0x${"a".repeat(40)}`;

function heartbeat(key: string, jobTypes: string[], updated_at = "2026-09-23 12:00:00"): AutomationHeartbeat {
  return { key, value: JSON.stringify({ jobTypes }), updated_at };
}

const fullWorkers = [
  heartbeat(`automation:solana:${buybackTreasury}`, ["sportpad_buyback_burn"]),
  heartbeat(`automation:solana:${rewardTreasury}`, ["solana_reward_purchase", "solana_claim_payout"]),
  heartbeat(`automation:chiliz:${chilizWallet}`, ["chiliz_reward_purchase", "chiliz_claim_unwrap"]),
];
const successfulMaintenance: MaintenanceRun[] = [
  { worker: "pump_fee_indexer", state: "succeeded", started_at: "2026-09-23 12:00:00", completed_at: "2026-09-23 12:00:01" },
  { worker: "holder_epoch_indexer", state: "succeeded", started_at: "2026-09-23 12:00:00", completed_at: "2026-09-23 12:00:02" },
  { worker: "treasury_observer", state: "succeeded", started_at: "2026-09-23 11:56:00", completed_at: "2026-09-23 11:56:02" },
];

test("a launch requires fresh chain-specific reward capabilities and the configured buyback signer", () => {
  assert.deepEqual(evaluateLaunchAutomationReadiness(fullWorkers, successfulMaintenance, "chiliz", buybackTreasury, rewardTreasury, now), { ready: true, missing: [] });
  assert.deepEqual(evaluateLaunchAutomationReadiness(fullWorkers, successfulMaintenance, "solana", buybackTreasury, rewardTreasury, now), { ready: true, missing: [] });
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers, successfulMaintenance, "chiliz", "different-treasury", rewardTreasury, now).ready, false);
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers, successfulMaintenance, "solana", buybackTreasury, "different-treasury", now).ready, false);
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers.slice(0, 2), successfulMaintenance, "chiliz", buybackTreasury, rewardTreasury, now).ready, false);
});

test("pre-mint Solana launches can accrue the 20% share without a buyback worker", () => {
  const withoutBuyback = fullWorkers.slice(1);
  assert.deepEqual(evaluateLaunchAutomationReadiness(
    withoutBuyback, successfulMaintenance, "solana", buybackTreasury,
    rewardTreasury, now, false,
  ), { ready: true, missing: [] });
  assert.equal(evaluateLaunchAutomationReadiness(
    withoutBuyback, successfulMaintenance, "solana", buybackTreasury,
    rewardTreasury, now, true,
  ).ready, false);
});

test("stale, malformed, and capability-incomplete worker heartbeats fail closed", () => {
  const stale = heartbeat(`automation:solana:${buybackTreasury}`, ["sportpad_buyback_burn", "solana_claim_payout"], "2026-09-23 11:58:00");
  assert.equal(evaluateLaunchAutomationReadiness([stale], successfulMaintenance, "solana", buybackTreasury, rewardTreasury, now).ready, false);
  assert.equal(evaluateLaunchAutomationReadiness([
    heartbeat(`automation:solana:${buybackTreasury}`, ["solana_claim_payout"]),
  ], successfulMaintenance, "solana", buybackTreasury, rewardTreasury, now).ready, false);
  assert.ok(evaluateLaunchAutomationReadiness([
    heartbeat(`automation:solana:${buybackTreasury}`, ["sportpad_buyback_burn", "solana_claim_payout"]),
    heartbeat(`automation:chiliz:${chilizWallet}`, ["chiliz_reward_purchase", "chiliz_claim_unwrap"]),
  ], successfulMaintenance, "solana", buybackTreasury, rewardTreasury, now).missing.includes("active Solana reward purchase worker"));
  assert.equal(evaluateLaunchAutomationReadiness([
    { key: `automation:solana:${buybackTreasury}`, value: "not-json", updated_at: "2026-09-23 12:00:00" },
  ], successfulMaintenance, "solana", buybackTreasury, rewardTreasury, now).ready, false);
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers, successfulMaintenance, "chiliz", null, rewardTreasury, now).ready, false);
});

test("every launch needs a fresh maintenance heartbeat and the latest successful maintenance receipts", () => {
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers.slice(0, 1), successfulMaintenance, "solana", buybackTreasury, rewardTreasury, now).ready, false);
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers, successfulMaintenance.slice(0, 2), "solana", buybackTreasury, rewardTreasury, now).ready, false);
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers, [
    ...successfulMaintenance,
    { worker: "pump_fee_indexer", state: "failed", started_at: "2026-09-23 12:00:20", completed_at: "2026-09-23 12:00:21" },
  ], "solana", buybackTreasury, rewardTreasury, now).ready, false);
  assert.equal(evaluateLaunchAutomationReadiness(fullWorkers, [
    ...successfulMaintenance.slice(0, 2),
    { ...successfulMaintenance[2], completed_at: "2026-09-23 11:52:00" },
  ], "solana", buybackTreasury, rewardTreasury, now).ready, false);
});
