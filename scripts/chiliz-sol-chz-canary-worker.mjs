import { ed25519 } from "@noble/curves/ed25519";
import { VersionedTransaction } from "@solana/web3.js";
import { prepareAndSignOfficialChzAta,
  prepareAndSignSolToChzSwap } from "../lib/server/providers/chiliz-solana-signing.ts";

const ENDPOINT = "/api/internal/workers/chiliz-sol-chz-canary";
const ONE_SHOT_SWAP_LAMPORTS = "1000000";

function fail(code) { throw new Error(`chz_solana_canary_${code}`); }

async function api(config, request) {
  const response = await config.fetcher(`${config.baseUrl}${ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json",
      Authorization: `Bearer ${config.workerToken}` },
    body: JSON.stringify(request), signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) fail(`api_${request.action}_failed`);
  return payload;
}

async function assertPublishedTreasury(config) {
  const response = await config.fetcher(`${config.baseUrl}/api/protocol/status`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail("published_treasury_unavailable");
  const status = await response.json();
  if (status?.treasuries?.reward !== config.rewardKeypair.publicKey.toBase58()) {
    fail("reward_key_not_published_treasury");
  }
}

/** One explicit startup action only. Signed bytes are durably inserted and
 * claimed into broadcast_unknown before a single RPC sendRawTransaction.
 * Any ambiguous send/finality leaves the state unknown; no replay. */
export async function runSolChzCanary(config) {
  if (process.env.SPORTPAD_CHZ_SOLANA_CANARY_WORKER_ENABLED !== "true") {
    fail("worker_flag_not_enabled");
  }
  const action = config.action;
  if (action !== "ata_setup" && action !== "sol_chz_swap") fail("action_invalid");
  if (!config.rewardKeypair || !config.connection || !config.jupiterKey ||
      !config.workerToken || !config.baseUrl) fail("configuration_missing");
  await assertPublishedTreasury(config);
  const existing = await api(config, { action: "inspect", operation: action });
  if (existing.journal) {
    return { operation: action, state: existing.journal.state,
      signature: existing.journal.signature, alreadyRecorded: true };
  }
  const rewardTreasury = config.rewardKeypair.publicKey.toBase58();
  const signer = {
    publicKey: config.rewardKeypair.publicKey,
    signMessage: (message) => ed25519.sign(message,
      config.rewardKeypair.secretKey.subarray(0, 32)),
  };
  const signed = action === "ata_setup"
    ? await prepareAndSignOfficialChzAta({ configuredRewardTreasury: rewardTreasury,
      connection: config.connection, signer })
    : await prepareAndSignSolToChzSwap({ configuredRewardTreasury: rewardTreasury,
      connection: config.connection, signer, apiKey: config.jupiterKey,
      inputLamports: ONE_SHOT_SWAP_LAMPORTS });
  if (action === "sol_chz_swap" &&
      BigInt(signed.plan.simulatedSolDebitLamports) > 1_500_000n) {
    fail("simulated_sol_debit_exceeds_1p5m");
  }
  const prepared = await api(config, { action: "prepare", operation: action, signed });
  if (prepared.journal?.signature !== signed.sourceSignature ||
      prepared.journal?.state !== "prepared") fail("durable_prepare_mismatch");
  const claimed = await api(config, { action: "claim", operation: action,
    signature: signed.sourceSignature });
  if (claimed.broadcast?.sourceSignature !== signed.sourceSignature ||
      claimed.broadcast?.state !== "broadcast_unknown" ||
      claimed.broadcast?.signedTransactionBase64 !== signed.signedTransactionBase64) {
    fail("durable_claim_mismatch");
  }
  const bytes = Buffer.from(claimed.broadcast.signedTransactionBase64, "base64");
  const exact = VersionedTransaction.deserialize(bytes);
  if (exact.signatures.length !== 1 ||
      exact.signatures[0].length !== 64) fail("persisted_signature_invalid");
  // This is the only network send in this module. Ambiguous errors are never retried.
  let sentSignature;
  try {
    sentSignature = await config.connection.sendRawTransaction(bytes, {
      skipPreflight: false, maxRetries: 0, preflightCommitment: "finalized",
    });
  } catch { fail("broadcast_unknown_no_replay"); }
  if (sentSignature !== signed.sourceSignature) fail("broadcast_signature_mismatch_no_replay");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    let status;
    try {
      const result = await config.connection.getSignatureStatuses(
        [signed.sourceSignature], { searchTransactionHistory: true });
      status = result.value[0];
    } catch { fail("finality_query_unknown_no_replay"); }
    if (status?.err) fail("finalized_transaction_failed_no_replay");
    if (status?.confirmationStatus === "finalized") {
      const finalized = await api(config, { action: "finalize", operation: action,
        signature: signed.sourceSignature });
      if (finalized.journal?.state !== "finalized_success") fail("receipt_not_verified");
      return { operation: action, state: "finalized_success",
        signature: signed.sourceSignature, slot: finalized.journal.slot,
        actualSpendLamports: finalized.journal.actualSpendLamports,
        actualOutputAtomic: finalized.journal.actualOutputAtomic };
    }
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  fail("finality_timeout_unknown_no_replay");
}
