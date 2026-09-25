import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { DIRECT_CHZ_OFT } from "../lib/server/providers/chiliz-direct-oft.ts";
import {
  createDirectOftCanaryJournalClient, readDirectOftCanaryConfig,
  runDirectOftCanary,
} from "./chiliz-direct-oft-canary-worker.mjs";

const sourceWallet = Keypair.fromSeed(new Uint8Array(32).fill(41))
  .publicKey.toBase58();
const sourceSigner = Keypair.fromSeed(new Uint8Array(32).fill(41));
const destinationTreasury = "0x42c40359da463b480c3dc9e7a4d9c1ac2ef45c21";
const sourceSignature = "2".repeat(88);
const signedHash = "a".repeat(64);
const quoteHash = "b".repeat(64);
const plan = {
  sourceWallet, destinationTreasury,
  sourceMint: DIRECT_CHZ_OFT.solanaMint,
  sourceProgram: DIRECT_CHZ_OFT.solanaProgram,
  sourceStore: DIRECT_CHZ_OFT.solanaStore,
  sourceLookupTable: DIRECT_CHZ_OFT.solanaAddressLookupTable,
  destinationEid: DIRECT_CHZ_OFT.chilizEid,
  destinationAdapter: DIRECT_CHZ_OFT.chilizNativeAdapter,
  sourceAmountAtomic: "1000000000", minimumDestinationWei: "9900000000000000000",
  messagingFeeLamports: "345783",
  onchainQuoteDigestSha256: quoteHash, expectedMessageSha256: "c".repeat(64),
  quoteExpiresAtMs: Date.now() + 120_000,
};
const source = {
  SPORTPAD_DIRECT_OFT_CANARY_WORKER_ENABLED: "true",
  SPORTPAD_DIRECT_OFT_CANARY_MODE: "broadcast",
  SPORTPAD_BASE_URL: "https://sportpad.fun",
  SOLANA_REWARD_TREASURY_ADDRESS: sourceWallet,
  CHILIZ_TREASURY_ADDRESS: destinationTreasury,
  SPORTPAD_DIRECT_OFT_CANARY_JOURNAL_ID: "oft-canary-1",
  SPORTPAD_DIRECT_OFT_CANARY_SIGNED_TX_SHA256: signedHash,
  SPORTPAD_DIRECT_OFT_CANARY_PLAN_JSON: JSON.stringify(plan),
  SPORTPAD_DIRECT_OFT_SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=test",
  SPORTPAD_DIRECT_OFT_PRIMARY_CHILIZ_RPC_URL: "https://chiliz-one.example/rpc",
  SPORTPAD_DIRECT_OFT_SECONDARY_CHILIZ_RPC_URL: "https://chiliz-two.example/rpc",
  SPORTPAD_WORKER_TOKEN: "test-worker-token",
};

function row(state = "prepared") {
  return {
    id: source.SPORTPAD_DIRECT_OFT_CANARY_JOURNAL_ID,
    policyKey: "initial", routeType: "OFT", sourceChain: "solana",
    destinationChainId: 88_888, sourceMint: DIRECT_CHZ_OFT.solanaMint,
    destinationAsset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    sourceWallet, destinationTreasury,
    sourceAmountAtomic: plan.sourceAmountAtomic,
    minimumDestinationWei: plan.minimumDestinationWei,
    quoteId: `oft:${quoteHash}`, quoteExpiresAtMs: plan.quoteExpiresAtMs,
    signedTransactionSha256: signedHash,
    signedTransactionBase64: Buffer.alloc(120, 1).toString("base64"),
    sourceSignature, state,
    broadcastAttemptedAtMs: state === "prepared" ? null : Date.now(),
  };
}

test("canary is disabled unless the separate local flag and explicit mode are set", () => {
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_WORKER_ENABLED: undefined }), /canary_disabled/);
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_MODE: undefined }), /mode_missing/);
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SPORTPAD_BASE_URL: "https://attacker.example" }), /base_url_invalid/);
});

test("independent treasury, route, amount and signed hash are required", () => {
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SOLANA_REWARD_TREASURY_ADDRESS: Keypair.generate().publicKey.toBase58() }),
  /plan_invalid/);
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_SIGNED_TX_SHA256: "bad" }), /signed_hash_invalid/);
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_PLAN_JSON: JSON.stringify({ ...plan,
      minimumDestinationWei: "1" }) }), /plan_invalid/);
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_SECONDARY_CHILIZ_RPC_URL: "https://chiliz-one.example/other" }),
  /rpcs_not_independent/);
});

test("explicit startup action pins safe defaults and derives Helius RPC from existing key", () => {
  const config = readDirectOftCanaryConfig({ ...source,
    SPORTPAD_CHZ_SOLANA_CANARY_ACTION: "direct_oft_prepare_broadcast",
    SPORTPAD_DIRECT_OFT_CANARY_MODE: undefined,
    SPORTPAD_DIRECT_OFT_CANARY_JOURNAL_ID: undefined,
    SPORTPAD_DIRECT_OFT_CANARY_AMOUNT_ATOMIC: undefined,
    SPORTPAD_DIRECT_OFT_CANARY_MINIMUM_RECEIVE_ATOMIC: undefined,
    SPORTPAD_DIRECT_OFT_CANARY_PLAN_JSON: undefined,
    SPORTPAD_DIRECT_OFT_CANARY_SIGNED_TX_SHA256: undefined,
    SPORTPAD_DIRECT_OFT_SOLANA_RPC_URL: undefined,
    SPORTPAD_DIRECT_OFT_PRIMARY_CHILIZ_RPC_URL: undefined,
    SPORTPAD_DIRECT_OFT_SECONDARY_CHILIZ_RPC_URL: undefined,
    SOLANA_REWARD_TREASURY_ADDRESS: undefined,
    SOLANA_REWARD_VAULT_PRIVATE_KEY: JSON.stringify([...sourceSigner.secretKey]),
    HELIUS_API_KEY: "test-helius-key",
  });
  assert.equal(config.mode, "prepare_broadcast");
  assert.equal(config.id, "initial");
  assert.equal(config.sourceWallet, sourceWallet);
  assert.equal(config.amountAtomic, "700000000");
  assert.equal(config.minimumReceiveAtomic, "665000000");
  assert.equal(config.solanaRpcUrl,
    "https://mainnet.helius-rpc.com/?api-key=test-helius-key");
  assert.equal(config.primaryChilizRpcUrl, "https://rpc.ankr.com/chiliz");
  assert.equal(config.secondaryChilizRpcUrl, "https://chiliz-rpc.publicnode.com/");
  assert.throws(() => readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_SOLANA_RPC_URL: "https://evil.example/?api-key=test" }),
  /solana_rpc_invalid/);
});

test("private API client never follows redirect or exposes token in URL", async () => {
  const config = readDirectOftCanaryConfig(source);
  const calls = [];
  const client = createDirectOftCanaryJournalClient(config, async (url, init) => {
    calls.push({ url, init });
    const input = JSON.parse(init.body);
    return Response.json(input.action === "load" ? { journal: row() } :
      { changedRows: 1, journal: row("broadcast_attempted") });
  });
  await client.load();
  await client.claim(sourceSignature, signedHash);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://sportpad.fun/api/internal/workers/chiliz-bridge");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-worker-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    action: "claim_broadcast", id: "oft-canary-1",
    workerId: `solana:${sourceWallet}`, sourceSignature,
    signedTransactionSha256: signedHash,
  });
});

test("broadcast uses a second persisted load and atomic claim, never local signed bytes", async () => {
  const config = readDirectOftCanaryConfig(source);
  let loads = 0;
  let claims = 0;
  const result = await runDirectOftCanary(config, {
    api: {
      load: async () => { loads++; return row(); },
      claim: async (sig, hash) => {
        claims++;
        assert.equal(sig, sourceSignature);
        assert.equal(hash, signedHash);
        return { changedRows: 1, journal: row("broadcast_attempted") };
      },
    },
    rpc: { getBalance: async () => 50_000_000 },
    broadcastImpl: async (input) => {
      assert.equal(input.expectedJournal.signedTransactionSha256, signedHash);
      assert.equal(input.expectedJournal.signedTransactionBase64,
        row().signedTransactionBase64);
      await input.loadPersisted(input.expectedJournal.id);
      const claim = await input.claimBroadcastAttempt(config.id, sourceSignature);
      assert.equal(claim.changedRows, 1);
      return { state: "submitted_pending", journalId: config.id, sourceSignature };
    },
  });
  assert.equal(result.state, "submitted_pending");
  assert.equal(loads, 2);
  assert.equal(claims, 1);
});

test("an attempted or mismatched journal cannot re-enter broadcast", async () => {
  const config = readDirectOftCanaryConfig(source);
  for (const stored of [row("broadcast_attempted"),
    { ...row(), signedTransactionSha256: "f".repeat(64) }]) {
    let broadcasted = false;
    await assert.rejects(runDirectOftCanary(config, {
      api: { load: async () => stored },
      broadcastImpl: async () => { broadcasted = true; },
    }), /state_invalid|identity_invalid/);
    assert.equal(broadcasted, false);
  }
});

test("reconcile mode performs no claim or broadcast", async () => {
  const config = readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_MODE: "reconcile" });
  const result = await runDirectOftCanary(config, {
    api: { load: async () => row("broadcast_attempted"),
      claim: async () => { throw Error("claim should not be called"); } },
    reconcileImpl: async () => ({ verified: true }),
    broadcastImpl: async () => { throw Error("send should not be called"); },
  });
  assert.equal(result.state, "delivered");
});

test("fresh sign mode persists exact signed bytes before any claim or send", async () => {
  const freshConfig = readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_MODE: "prepare_broadcast",
    SPORTPAD_DIRECT_OFT_CANARY_AMOUNT_ATOMIC: plan.sourceAmountAtomic,
    SPORTPAD_DIRECT_OFT_CANARY_MINIMUM_RECEIVE_ATOMIC: "990000000",
    SOLANA_REWARD_VAULT_PRIVATE_KEY:
      JSON.stringify([...sourceSigner.secretKey]),
    SPORTPAD_DIRECT_OFT_CANARY_PLAN_JSON: undefined,
    SPORTPAD_DIRECT_OFT_CANARY_SIGNED_TX_SHA256: undefined,
  });
  const events = [];
  const result = await runDirectOftCanary(freshConfig, {
    api: {
      probe: async () => { events.push("probe"); return null; },
      inspectFinalizedSwap: async () => { events.push("inspect");
        return { operation: "sol_chz_swap", state: "finalized_success",
          sourceWallet, signature: "swap-signature", actualOutputAtomic: "1000000000" }; },
      prepare: async (built, signedBase64) => {
        events.push("prepare");
        assert.equal(built.sourceWallet, sourceWallet);
        assert.equal(signedBase64, row().signedTransactionBase64);
        return row();
      },
      load: async () => { events.push("load"); return row(); },
      claim: async () => { events.push("claim");
        return { changedRows: 1, journal: row("broadcast_attempted") }; },
    },
    buildPlanImpl: async () => ({ ...plan, minimumReceiveAtomic: "990000000" }),
    signImpl: async ({ signer, intent }) => {
      events.push("sign");
      assert.equal(signer.publicKey, sourceWallet);
      assert.equal(intent.sourceAmountAtomic, plan.sourceAmountAtomic);
      return { signedTransactionBase64: row().signedTransactionBase64,
        signedTransactionSha256: signedHash, sourceSignature };
    },
    rpc: { getBalance: async () => 50_000_000 },
    broadcastImpl: async (input) => {
      events.push("broadcast");
      await input.loadPersisted(freshConfig.id);
      await input.claimBroadcastAttempt(freshConfig.id, sourceSignature);
      return { state: "submitted_pending", journalId: freshConfig.id, sourceSignature };
    },
  });
  assert.equal(result.state, "submitted_pending");
  assert.deepEqual(events, ["probe", "inspect", "sign", "prepare", "load", "broadcast", "load", "claim"]);
});

test("wrong reward secret never prepares or sends", async () => {
  const freshConfig = readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_MODE: "prepare_broadcast",
    SPORTPAD_DIRECT_OFT_CANARY_AMOUNT_ATOMIC: plan.sourceAmountAtomic,
    SPORTPAD_DIRECT_OFT_CANARY_MINIMUM_RECEIVE_ATOMIC: "990000000",
    SOLANA_REWARD_VAULT_PRIVATE_KEY:
      JSON.stringify([...Keypair.generate().secretKey]),
  });
  let called = false;
  await assert.rejects(runDirectOftCanary(freshConfig, {
    api: { probe: async () => null, prepare: async () => { called = true; } },
    buildPlanImpl: async () => { called = true; },
  }), /signer_treasury_mismatch/);
  assert.equal(called, false);
});

test("restart with a reserved intent never re-signs or broadcasts", async () => {
  const freshConfig = readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_MODE: "prepare_broadcast",
    SPORTPAD_DIRECT_OFT_CANARY_AMOUNT_ATOMIC: plan.sourceAmountAtomic,
    SPORTPAD_DIRECT_OFT_CANARY_MINIMUM_RECEIVE_ATOMIC: "990000000",
    SOLANA_REWARD_VAULT_PRIVATE_KEY:
      JSON.stringify([...sourceSigner.secretKey]),
  });
  let touched = false;
  await assert.rejects(runDirectOftCanary(freshConfig, {
    api: { probe: async () => row("broadcast_attempted") },
    buildPlanImpl: async () => { touched = true; },
    signImpl: async () => { touched = true; },
    broadcastImpl: async () => { touched = true; },
  }), /already_reserved/);
  assert.equal(touched, false);
});

test("fresh preparation requires finalized swap output and bounded fee before signing", async () => {
  const freshConfig = readDirectOftCanaryConfig({ ...source,
    SPORTPAD_DIRECT_OFT_CANARY_MODE: "prepare_broadcast",
    SPORTPAD_DIRECT_OFT_CANARY_AMOUNT_ATOMIC: plan.sourceAmountAtomic,
    SPORTPAD_DIRECT_OFT_CANARY_MINIMUM_RECEIVE_ATOMIC: "990000000",
    SOLANA_REWARD_VAULT_PRIVATE_KEY: JSON.stringify([...sourceSigner.secretKey]),
  });
  let touched = false;
  await assert.rejects(runDirectOftCanary(freshConfig, {
    api: { probe: async () => null,
      inspectFinalizedSwap: async () => ({ operation: "sol_chz_swap",
        state: "broadcast_unknown", sourceWallet,
        signature: "swap", actualOutputAtomic: "1000000000" }) },
    buildPlanImpl: async () => { touched = true; },
  }), /swap_output_insufficient/);
  assert.equal(touched, false);
  await assert.rejects(runDirectOftCanary(freshConfig, {
    api: { probe: async () => null,
      inspectFinalizedSwap: async () => ({ operation: "sol_chz_swap",
        state: "finalized_success", sourceWallet,
        signature: "swap", actualOutputAtomic: "999999999" }) },
    buildPlanImpl: async () => { touched = true; },
  }), /swap_output_insufficient/);
  assert.equal(touched, false);
  await assert.rejects(runDirectOftCanary(freshConfig, {
    api: { probe: async () => null,
      inspectFinalizedSwap: async () => ({ operation: "sol_chz_swap",
        state: "finalized_success", sourceWallet,
        signature: "swap", actualOutputAtomic: "1000000000" }) },
    buildPlanImpl: async () => ({ ...plan, minimumReceiveAtomic: "990000000",
      messagingFeeLamports: "500001" }),
    signImpl: async () => { touched = true; },
  }), /fresh_plan_invalid/);
  assert.equal(touched, false);
});

test("broadcast refuses insufficient SOL reserve before any claim", async () => {
  const config = readDirectOftCanaryConfig(source);
  let claimed = false;
  await assert.rejects(runDirectOftCanary(config, {
    api: { load: async () => row(), claim: async () => { claimed = true; } },
    rpc: { getBalance: async () => 45_300_000 },
    broadcastImpl: async () => { claimed = true; },
  }), /sol_reserve_insufficient/);
  assert.equal(claimed, false);
});
