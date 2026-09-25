import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getAddress } from "viem";
import { DIRECT_CHZ_OFT } from "../lib/server/providers/chiliz-direct-oft.ts";
import { buildUnsignedDirectOftChzTransfer } from
  "../lib/server/providers/chiliz-direct-oft-build.ts";
import { signDirectOftChilizJournal } from
  "../lib/server/providers/chiliz-direct-oft-sign.ts";
import { prepareDirectOftChilizBridgeJournalInsert } from
  "../lib/server/providers/chiliz-direct-oft-journal.ts";

const API_PATH = "/api/internal/workers/chiliz-repeat-bridge";
const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const POSITIVE = /^[1-9][0-9]*$/;

function fail(code) { throw new Error(code); }

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) fail(`repeat_bridge_${name.toLowerCase()}_missing`);
  return value;
}

function httpsUrl(value, code) {
  let url;
  try { url = new URL(value); } catch { fail(code); }
  if (url.protocol !== "https:" || !url.hostname || url.username ||
      url.password || url.hash) fail(code);
  return url;
}

export function readRepeatBridgeWorkerConfig(source = process.env) {
  if (source.SPORTPAD_REPEAT_BRIDGE_WORKER_ENABLED !== "true") {
    fail("repeat_bridge_worker_disabled");
  }
  const mode = required(source, "SPORTPAD_REPEAT_BRIDGE_MODE");
  if (!["prepare_broadcast", "reconcile"].includes(mode)) {
    fail("repeat_bridge_mode_invalid");
  }
  const baseUrl = httpsUrl(required(source, "SPORTPAD_BASE_URL"),
    "repeat_bridge_base_url_invalid");
  if (baseUrl.origin !== "https://sportpad.fun" ||
      baseUrl.pathname !== "/" || baseUrl.search) {
    fail("repeat_bridge_base_url_invalid");
  }
  const bridgeId = required(source, "SPORTPAD_REPEAT_BRIDGE_ID");
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(bridgeId)) fail("repeat_bridge_id_invalid");
  const sourceWallet = required(source, "SOLANA_REWARD_TREASURY_ADDRESS");
  try {
    const key = new PublicKey(sourceWallet);
    if (!PublicKey.isOnCurve(key) || key.toBase58() !== sourceWallet) throw Error();
  } catch { fail("repeat_bridge_source_wallet_invalid"); }
  let destinationTreasury;
  try {
    destinationTreasury = getAddress(required(source, "CHILIZ_TREASURY_ADDRESS"))
      .toLowerCase();
  } catch { fail("repeat_bridge_destination_invalid"); }
  const solanaRpcUrl = httpsUrl(required(source,
    "SPORTPAD_DIRECT_OFT_SOLANA_RPC_URL"), "repeat_bridge_rpc_invalid").href;
  return Object.freeze({ mode, baseUrl: baseUrl.origin, bridgeId,
    workerToken: required(source, "SPORTPAD_WORKER_TOKEN"),
    sourceWallet, destinationTreasury, solanaRpcUrl,
    rewardSecret: source.SOLANA_REWARD_VAULT_PRIVATE_KEY?.trim() ?? null });
}

export function createRepeatBridgeApi(config, fetchImpl = fetch) {
  async function call(body, { pendingOkay = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${API_PATH}`, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json",
          Authorization: `Bearer ${config.workerToken}` },
        body: JSON.stringify({ ...body, bridgeId: config.bridgeId,
          workerId: `solana:${config.sourceWallet}` }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { fail("repeat_bridge_api_unavailable"); }
    let payload;
    try {
      const raw = await response.text();
      if (raw.length > 60_000) throw Error();
      payload = JSON.parse(raw);
    } catch { fail("repeat_bridge_api_invalid"); }
    if (!payload || typeof payload !== "object") fail("repeat_bridge_api_invalid");
    if (pendingOkay && response.status === 409 &&
        payload.state === "verification_pending_or_held") {
      return { state: "verification_pending_or_held" };
    }
    if (!response.ok) fail(`repeat_bridge_api_${response.status}`);
    return payload;
  }
  return Object.freeze({
    inspect: () => call({ action: "inspect" }),
    prepare: (attemptSequence, plan, signedTransactionBase64) =>
      call({ action: "prepare", attemptSequence, plan, signedTransactionBase64 }),
    claim: (attemptSequence) => call({ action: "claim", attemptSequence }),
    reconcile: (attemptSequence) => call({ action: "reconcile", attemptSequence },
      { pendingOkay: true }),
  });
}

function signer(config) {
  if (!config.rewardSecret) fail("repeat_bridge_reward_key_missing");
  let secret;
  let keypair;
  try {
    secret = config.rewardSecret.startsWith("[") ?
      Uint8Array.from(JSON.parse(config.rewardSecret)) : bs58.decode(config.rewardSecret);
    if (secret.length !== 64) throw Error();
    keypair = Keypair.fromSecretKey(secret);
  } catch { fail("repeat_bridge_reward_key_invalid"); }
  if (keypair.publicKey.toBase58() !== config.sourceWallet) {
    fail("repeat_bridge_reward_key_mismatch");
  }
  return { publicKey: config.sourceWallet,
    signMessage: async (message) => ed25519.sign(message, secret.slice(0, 32)) };
}

function inspectSnapshot(value, config) {
  if (!value || typeof value !== "object" || !value.bridge ||
      typeof value.bridge !== "object" || !POSITIVE.test(
        value.bridge.sourceAmountAtomic ?? "") ||
      BigInt(value.bridge.sourceAmountAtomic) > 1_000_000_000n ||
      !POSITIVE.test(value.bridge.minimumDestinationWei ?? "") ||
      BigInt(value.bridge.minimumDestinationWei) % 10_000_000_000n !== 0n ||
      value.bridge.id !== config.bridgeId ||
      !["collecting", "broadcast_unknown", "source_finalized", "held",
        "destination_finalized"].includes(value.bridge.state)) {
    fail("repeat_bridge_inspection_invalid");
  }
  return value;
}

/** One bridge ID per invocation. Never rebroadcast after a durable claim. */
export async function runRepeatBridgeWorker(config, deps = {}) {
  const api = deps.api ?? createRepeatBridgeApi(config, deps.fetchImpl);
  const snapshot = inspectSnapshot(await api.inspect(), config);
  if (snapshot.bridge.state === "destination_finalized") {
    return { state: "destination_finalized", bridgeId: config.bridgeId };
  }
  if (config.mode === "reconcile" || snapshot.bridge.state !== "collecting") {
    if (!snapshot.attempt || snapshot.attempt.state !== "claimed") {
      fail("repeat_bridge_claimed_attempt_missing");
    }
    return api.reconcile(snapshot.attempt.sequence);
  }
  if (config.mode !== "prepare_broadcast") fail("repeat_bridge_mode_invalid");
  let sequence;
  let locallySigned = null;
  if (snapshot.attempt === null) {
    sequence = 0;
    const minimumReceiveAtomic = (BigInt(snapshot.bridge.minimumDestinationWei) /
      10_000_000_000n).toString();
    const plan = await (deps.buildPlanImpl ?? buildUnsignedDirectOftChzTransfer)({
      amountAtomic: snapshot.bridge.sourceAmountAtomic,
      minimumReceiveAtomic,
      payerSolanaWallet: config.sourceWallet,
      destinationChilizWallet: config.destinationTreasury,
      solanaRpcUrl: config.solanaRpcUrl,
    });
    if (plan.sourceMint !== DIRECT_CHZ_OFT.solanaMint ||
        plan.sourceAmountAtomic !== snapshot.bridge.sourceAmountAtomic ||
        plan.minimumDestinationWei !== snapshot.bridge.minimumDestinationWei) {
      fail("repeat_bridge_fresh_plan_invalid");
    }
    locallySigned = await (deps.signImpl ?? signDirectOftChilizJournal)({
      id: config.bridgeId, plan,
      intent: { sourceWallet: config.sourceWallet,
        destinationTreasury: config.destinationTreasury,
        sourceAmountAtomic: snapshot.bridge.sourceAmountAtomic,
        minimumDestinationWei: snapshot.bridge.minimumDestinationWei,
        quoteId: `oft:${plan.onchainQuoteDigestSha256}` },
      signer: signer(config), solanaRpcUrl: config.solanaRpcUrl,
      fetchImpl: deps.fetchImpl,
    });
    const prepared = await api.prepare(sequence, plan,
      locallySigned.signedTransactionBase64);
    if (prepared.bridgeId !== config.bridgeId ||
        prepared.attemptSequence !== sequence ||
        prepared.sourceSignature !== locallySigned.sourceSignature) {
      fail("repeat_bridge_prepare_mismatch");
    }
  } else if (snapshot.attempt.state === "prepared") {
    sequence = snapshot.attempt.sequence;
  } else {
    // A previously claimed attempt is never sent again; an abandoned attempt
    // requires a fresh explicit work item after independent expiry proof.
    fail("repeat_bridge_existing_attempt_requires_reconciliation");
  }
  const claimed = await api.claim(sequence);
  if (claimed.bridgeId !== config.bridgeId ||
      typeof claimed.sourceSignature !== "string" ||
      typeof claimed.signedTransactionBase64 !== "string" ||
      !claimed.plan || typeof claimed.plan !== "object") {
    fail("repeat_bridge_claim_response_invalid");
  }
  if (locallySigned && (locallySigned.sourceSignature !== claimed.sourceSignature ||
      locallySigned.signedTransactionBase64 !== claimed.signedTransactionBase64)) {
    fail("repeat_bridge_claim_local_signature_mismatch");
  }
  // Independently verify the returned transaction's exact signed OFT message.
  const verified = await prepareDirectOftChilizBridgeJournalInsert({
    id: config.bridgeId, plan: claimed.plan,
    expectedSourceWallet: config.sourceWallet,
    expectedDestinationTreasury: config.destinationTreasury,
    signedTransactionBase64: claimed.signedTransactionBase64,
  });
  if (verified.sourceSignature !== claimed.sourceSignature ||
      verified.sourceAmountAtomic !== snapshot.bridge.sourceAmountAtomic ||
      verified.minimumDestinationWei !== snapshot.bridge.minimumDestinationWei) {
    fail("repeat_bridge_claim_signed_identity_invalid");
  }
  const rpc = deps.rpc ?? new Connection(config.solanaRpcUrl, "confirmed");
  const [genesis, height] = await Promise.all([
    rpc.getGenesisHash(), rpc.getBlockHeight("confirmed"),
  ]);
  if (genesis !== SOLANA_MAINNET_GENESIS ||
      !Number.isSafeInteger(height) ||
      height + 10 >= claimed.plan.lastValidBlockHeight ||
      claimed.plan.quoteExpiresAtMs <= Date.now() + 30_000) {
    return { state: "broadcast_unknown", bridgeId: config.bridgeId,
      sourceSignature: claimed.sourceSignature };
  }
  let sentSignature = null;
  try {
    sentSignature = await rpc.sendRawTransaction(
      Buffer.from(claimed.signedTransactionBase64, "base64"),
      { skipPreflight: false, maxRetries: 0 });
  } catch { /* Unknown outcome: never resend after durable claim. */ }
  return { state: sentSignature === claimed.sourceSignature ?
    "submitted_pending" : "broadcast_unknown", bridgeId: config.bridgeId,
    sourceSignature: claimed.sourceSignature };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const outcome = await runRepeatBridgeWorker(readRepeatBridgeWorkerConfig());
    // Signed bytes, private keys, worker tokens and RPC URLs never enter logs.
    process.stdout.write(`${JSON.stringify({ state: outcome.state,
      bridgeId: outcome.bridgeId ?? null,
      sourceSignature: outcome.sourceSignature ?? null })}\n`);
  } catch (error) {
    const code = error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message) ?
      error.message : "repeat_bridge_worker_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
