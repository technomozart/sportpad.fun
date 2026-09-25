import assert from "node:assert/strict";
import test from "node:test";
import {
  readRepeatBridgeWorkerConfig, runRepeatBridgeWorker,
} from "./chiliz-repeat-bridge-worker.mjs";

const bridge = {
  id: "bridge-1", sourceAmountAtomic: "100000000",
  minimumDestinationWei: "990000000000000000",
};
const config = {
  mode: "prepare_broadcast", bridgeId: "bridge-1",
  sourceWallet: "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4",
  destinationTreasury: `0x${"a".repeat(40)}`,
};

test("repeatable bridge worker is off unless explicitly enabled", () => {
  assert.throws(() => readRepeatBridgeWorkerConfig({}),
    /repeat_bridge_worker_disabled/);
});

test("unknown broadcast outcome only reconciles and never claims or re-sends", async () => {
  let reconciles = 0;
  const result = await runRepeatBridgeWorker(config, { api: {
    inspect: async () => ({ bridge: { ...bridge, state: "broadcast_unknown" },
      attempt: { sequence: 0, state: "claimed" } }),
    reconcile: async (sequence) => {
      assert.equal(sequence, 0);
      reconciles++;
      return { state: "verification_pending_or_held" };
    },
    claim: () => assert.fail("must not re-claim"),
    prepare: () => assert.fail("must not re-prepare"),
  }, rpc: { sendRawTransaction: () => assert.fail("must not rebroadcast") } });
  assert.equal(result.state, "verification_pending_or_held");
  assert.equal(reconciles, 1);
});

test("abandoned attempts require a separate verified work item", async () => {
  await assert.rejects(runRepeatBridgeWorker(config, { api: {
    inspect: async () => ({ bridge: { ...bridge, state: "collecting" },
      attempt: { sequence: 0, state: "abandoned_unbroadcast" } }),
    claim: () => assert.fail("must not claim"),
    prepare: () => assert.fail("must not prepare automatically"),
  } }), /repeat_bridge_existing_attempt_requires_reconciliation/);
});

test("finalized destination never triggers a financial action", async () => {
  const result = await runRepeatBridgeWorker(config, { api: {
    inspect: async () => ({ bridge: { ...bridge, state: "destination_finalized" },
      attempt: { sequence: 0, state: "claimed" } }),
    claim: () => assert.fail("must not claim"),
    reconcile: () => assert.fail("already finalized"),
  } });
  assert.equal(result.state, "destination_finalized");
});
