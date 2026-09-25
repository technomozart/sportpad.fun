import { Buffer } from "node:buffer";
import type { UnsignedDirectOftChzTransfer } from "./providers/chiliz-direct-oft-build.ts";
import { prepareDirectOftChilizBridgeJournalInsert } from
  "./providers/chiliz-direct-oft-journal.ts";
import { reconcileDirectOftChilizBridge } from
  "./providers/direct-oft-reconcile.ts";

const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SOURCE_MINT = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const ID = /^[A-Za-z0-9:_-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;
type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ReadOnlySolanaClaimRpc = {
  getGenesisHash(): Promise<string>;
  getBlockHeight(commitment: "confirmed"): Promise<number>;
  getSignatureStatuses(signatures: string[], options: {
    searchTransactionHistory: true;
  }): Promise<{ value: unknown[] }>;
};

type BridgeRow = {
  id: string; source_wallet: string; destination_treasury: string;
  source_mint: string; destination_chain_id: number;
  source_amount_atomic: string; minimum_destination_wei: string;
  quote_id: string | null; quote_expires_at_ms: number | null;
  signed_transaction_base64: string | null;
  signed_transaction_sha256: string | null; source_signature: string | null;
  state: string; broadcast_attempted_at_ms: number | null;
  source_finalized_slot: number | null; bridge_message_id: string | null;
  destination_tx_hash: string | null; destination_received_wei: string | null;
};

type AttemptRow = {
  bridge_id: string; attempt_sequence: number; quote_id: string;
  quote_expires_at_ms: number; signed_transaction_base64: string;
  signed_transaction_sha256: string; source_signature: string;
  plan_json: string; plan_sha256: string; state: string;
  prepared_at_ms: number; claimed_at_ms: number | null;
};

function fail(code: string): never { throw new Error(code); }

async function sha256(value: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(value))).toString("hex");
}

function identity(row: BridgeRow, bridgeId: string, source: string,
  destination: string): void {
  if (row.id !== bridgeId || row.source_wallet !== source ||
      row.destination_treasury !== destination ||
      row.source_mint !== SOURCE_MINT || row.destination_chain_id !== 88_888 ||
      !/^[1-9][0-9]*$/.test(row.source_amount_atomic) ||
      BigInt(row.source_amount_atomic) > 1_000_000_000n ||
      !/^[1-9][0-9]*$/.test(row.minimum_destination_wei) ||
      BigInt(row.minimum_destination_wei) >
        BigInt(row.source_amount_atomic) * 10_000_000_000n ||
      BigInt(row.minimum_destination_wei) * 100n <
        BigInt(row.source_amount_atomic) * 95n * 10_000_000_000n) {
    fail("repeat_bridge_identity_invalid");
  }
}

async function loadBridge(db: D1Database, id: string): Promise<BridgeRow> {
  const row = await db.prepare("SELECT * FROM chiliz_bridge_transfers WHERE id=?1")
    .bind(id).first<BridgeRow>();
  if (!row) fail("repeat_bridge_not_found");
  return row;
}

async function loadAttempt(db: D1Database, id: string,
  sequence: number): Promise<AttemptRow> {
  const row = await db.prepare(`SELECT * FROM chiliz_bridge_attempts
    WHERE bridge_id=?1 AND attempt_sequence=?2`).bind(id, sequence).first<AttemptRow>();
  if (!row) fail("repeat_bridge_attempt_not_found");
  return row;
}

async function storedPlan(row: AttemptRow): Promise<UnsignedDirectOftChzTransfer> {
  if (!SHA256.test(row.plan_sha256) ||
      await sha256(row.plan_json) !== row.plan_sha256) {
    fail("repeat_bridge_plan_hash_invalid");
  }
  let plan: UnsignedDirectOftChzTransfer;
  try { plan = JSON.parse(row.plan_json) as UnsignedDirectOftChzTransfer; }
  catch { return fail("repeat_bridge_plan_json_invalid"); }
  if (plan.quoteExpiresAtMs !== row.quote_expires_at_ms ||
      `oft:${plan.onchainQuoteDigestSha256}` !== row.quote_id ||
      typeof plan.sourceEscrow !== "string" ||
      typeof plan.sourceTokenAccount !== "string" ||
      !SHA256.test(plan.expectedMessageSha256)) {
    fail("repeat_bridge_plan_identity_invalid");
  }
  return plan;
}

function attemptMatchesBridge(attempt: AttemptRow, bridge: BridgeRow): boolean {
  return bridge.quote_id === attempt.quote_id &&
    bridge.quote_expires_at_ms === attempt.quote_expires_at_ms &&
    bridge.signed_transaction_base64 === attempt.signed_transaction_base64 &&
    bridge.signed_transaction_sha256 === attempt.signed_transaction_sha256 &&
    bridge.source_signature === attempt.source_signature;
}

/** Persist a signed, locally verified attempt; this never claims or broadcasts. */
export async function prepareRepeatBridgeAttempt(input: {
  db: D1Database; bridgeId: string; attemptSequence: number;
  plan: UnsignedDirectOftChzTransfer; signedTransactionBase64: string;
  expectedSourceWallet: string; expectedDestinationTreasury: string;
  nowMs?: number;
}): Promise<{ bridgeId: string; attemptSequence: number;
  sourceSignature: string; quoteExpiresAtMs: number }> {
  const nowMs = input.nowMs ?? Date.now();
  if (!ID.test(input.bridgeId) || !Number.isSafeInteger(input.attemptSequence) ||
      input.attemptSequence < 0 || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    fail("repeat_bridge_prepare_input_invalid");
  }
  const bridge = await loadBridge(input.db, input.bridgeId);
  identity(bridge, input.bridgeId, input.expectedSourceWallet,
    input.expectedDestinationTreasury);
  if (bridge.state !== "collecting" || bridge.source_signature !== null) {
    fail("repeat_bridge_not_collecting");
  }
  const intent = await prepareDirectOftChilizBridgeJournalInsert({
    id: input.bridgeId, plan: input.plan,
    expectedSourceWallet: input.expectedSourceWallet,
    expectedDestinationTreasury: input.expectedDestinationTreasury,
    signedTransactionBase64: input.signedTransactionBase64, nowMs,
  });
  if (intent.sourceAmountAtomic !== bridge.source_amount_atomic ||
      intent.minimumDestinationWei !== bridge.minimum_destination_wei) {
    fail("repeat_bridge_attempt_amount_invalid");
  }
  const planJson = JSON.stringify(input.plan);
  if (planJson.length > 30_000) fail("repeat_bridge_plan_too_large");
  const result = await input.db.prepare(`INSERT INTO chiliz_bridge_attempts
    (bridge_id,attempt_sequence,quote_id,quote_expires_at_ms,
     signed_transaction_base64,signed_transaction_sha256,source_signature,
     plan_json,plan_sha256,prepared_at_ms)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
    .bind(input.bridgeId, input.attemptSequence, intent.quoteId,
      intent.quoteExpiresAtMs, intent.signedTransactionBase64,
      intent.signedTransactionSha256, intent.sourceSignature,
      planJson, await sha256(planJson), nowMs).run();
  if (!result.success || result.meta.changes !== 1) {
    fail("repeat_bridge_attempt_insert_failed");
  }
  return { bridgeId: input.bridgeId, attemptSequence: input.attemptSequence,
    sourceSignature: intent.sourceSignature,
    quoteExpiresAtMs: intent.quoteExpiresAtMs };
}

const CLAIM_ASSERT_SQL = `INSERT INTO chiliz_bridge_attempts (bridge_id)
  SELECT NULL WHERE NOT EXISTS (
    SELECT 1 FROM chiliz_bridge_transfers b
    JOIN chiliz_bridge_attempts a ON a.bridge_id=b.id
    WHERE b.id=?1 AND a.attempt_sequence=?2
      AND b.state='broadcast_unknown' AND a.state='claimed'
      AND b.source_signature=?3 AND a.source_signature=?3
      AND b.broadcast_attempted_at_ms=?4 AND a.claimed_at_ms=?4
      AND b.signed_transaction_sha256=a.signed_transaction_sha256
      AND b.quote_id=a.quote_id
  )`;

/**
 * Durable one-shot claim. This is the sole operation returning signed bytes to
 * the sender. The caller must NOT send before this D1 batch commits. A crash
 * after claim is an unknown send outcome and may only be reconciled by the
 * persisted signature; never prepare/retry another attempt.
 */
export async function claimRepeatBridgeAttempt(input: {
  db: D1Database; bridgeId: string; attemptSequence: number;
  expectedSourceWallet: string; expectedDestinationTreasury: string;
  rpc: ReadOnlySolanaClaimRpc;
  nowMs?: number;
}): Promise<{ bridgeId: string; sourceSignature: string;
  signedTransactionBase64: string; plan: UnsignedDirectOftChzTransfer }> {
  const nowMs = input.nowMs ?? Date.now();
  if (!ID.test(input.bridgeId) || !Number.isSafeInteger(input.attemptSequence) ||
      input.attemptSequence < 0 || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    fail("repeat_bridge_claim_input_invalid");
  }
  const [bridge, attempt] = await Promise.all([
    loadBridge(input.db, input.bridgeId),
    loadAttempt(input.db, input.bridgeId, input.attemptSequence),
  ]);
  identity(bridge, input.bridgeId, input.expectedSourceWallet,
    input.expectedDestinationTreasury);
  if (bridge.state !== "collecting" || attempt.state !== "prepared" ||
      bridge.source_signature !== null ||
      attempt.quote_expires_at_ms <= nowMs + 30_000) {
    fail("repeat_bridge_claim_state_invalid");
  }
  const plan = await storedPlan(attempt);
  const intent = await prepareDirectOftChilizBridgeJournalInsert({
    id: input.bridgeId, plan,
    expectedSourceWallet: input.expectedSourceWallet,
    expectedDestinationTreasury: input.expectedDestinationTreasury,
    signedTransactionBase64: attempt.signed_transaction_base64, nowMs,
  });
  if (intent.sourceAmountAtomic !== bridge.source_amount_atomic ||
      intent.minimumDestinationWei !== bridge.minimum_destination_wei ||
      intent.quoteId !== attempt.quote_id ||
      intent.sourceSignature !== attempt.source_signature ||
      intent.signedTransactionSha256 !== attempt.signed_transaction_sha256) {
    fail("repeat_bridge_claim_identity_invalid");
  }
  const [genesis, height, status] = await Promise.all([
    input.rpc.getGenesisHash(), input.rpc.getBlockHeight("confirmed"),
    input.rpc.getSignatureStatuses([attempt.source_signature],
      { searchTransactionHistory: true }),
  ]);
  if (genesis !== SOLANA_MAINNET_GENESIS ||
      !Number.isSafeInteger(height) || height <= 0 ||
      height + 10 >= plan.lastValidBlockHeight ||
      !status || !Array.isArray(status.value) ||
      status.value.length !== 1 || status.value[0] !== null) {
    fail("repeat_bridge_claim_chain_preflight_invalid");
  }
  const batch = await input.db.batch([
    input.db.prepare(`UPDATE chiliz_bridge_transfers SET state='prepared',
      quote_id=?2,quote_expires_at_ms=?3,signed_transaction_base64=?4,
      signed_transaction_sha256=?5,source_signature=?6,updated_at=CURRENT_TIMESTAMP
      WHERE id=?1 AND state='collecting' AND source_signature IS NULL`)
      .bind(input.bridgeId, attempt.quote_id, attempt.quote_expires_at_ms,
        attempt.signed_transaction_base64, attempt.signed_transaction_sha256,
        attempt.source_signature),
    input.db.prepare(`UPDATE chiliz_bridge_transfers
      SET state='broadcast_unknown',broadcast_attempted_at_ms=?3,
      updated_at=CURRENT_TIMESTAMP
      WHERE id=?1 AND state='prepared' AND source_signature=?2`)
      .bind(input.bridgeId, attempt.source_signature, nowMs),
    input.db.prepare(`UPDATE chiliz_bridge_attempts
      SET state='claimed',claimed_at_ms=?3
      WHERE bridge_id=?1 AND attempt_sequence=?2 AND state='prepared'`)
      .bind(input.bridgeId, input.attemptSequence, nowMs),
    input.db.prepare(CLAIM_ASSERT_SQL).bind(input.bridgeId,
      input.attemptSequence, attempt.source_signature, nowMs),
  ]);
  if (batch.length !== 4 || batch.some((item) => !item.success) ||
      batch[0].meta.changes !== 1 || batch[1].meta.changes !== 1 ||
      batch[2].meta.changes !== 1 || batch[3].meta.changes !== 0) {
    fail("repeat_bridge_claim_failed");
  }
  return { bridgeId: input.bridgeId, sourceSignature: attempt.source_signature,
    signedTransactionBase64: attempt.signed_transaction_base64, plan };
}

/** Read-only chain proof followed by an atomic source+destination receipt CAS.
 * Source may remain `broadcast_unknown` while the destination is pending. */
export async function reconcileRepeatBridgeDelivery(input: {
  db: D1Database; bridgeId: string; attemptSequence: number;
  expectedSourceWallet: string; expectedDestinationTreasury: string;
  solanaRpcUrl: string; primaryChilizRpcUrl: string;
  secondaryChilizRpcUrl: string; fetchImpl?: RpcFetch;
}): Promise<{ bridgeId: string; state: "destination_finalized";
  sourceSignature: string; destinationTxHash: string; receivedWei: string }> {
  if (!ID.test(input.bridgeId) || !Number.isSafeInteger(input.attemptSequence) ||
      input.attemptSequence < 0) fail("repeat_bridge_reconcile_input_invalid");
  const [bridge, attempt] = await Promise.all([
    loadBridge(input.db, input.bridgeId),
    loadAttempt(input.db, input.bridgeId, input.attemptSequence),
  ]);
  identity(bridge, input.bridgeId, input.expectedSourceWallet,
    input.expectedDestinationTreasury);
  if (!attemptMatchesBridge(attempt, bridge) || attempt.state !== "claimed" ||
      !["broadcast_unknown", "source_finalized", "held", "destination_finalized"]
        .includes(bridge.state) || !bridge.broadcast_attempted_at_ms) {
    fail("repeat_bridge_reconcile_state_invalid");
  }
  const plan = await storedPlan(attempt);
  if (plan.sourceWallet !== bridge.source_wallet ||
      plan.destinationTreasury.toLowerCase() !== bridge.destination_treasury ||
      plan.sourceAmountAtomic !== bridge.source_amount_atomic ||
      plan.minimumDestinationWei !== bridge.minimum_destination_wei) {
    fail("repeat_bridge_reconcile_plan_invalid");
  }
  const evidence = await reconcileDirectOftChilizBridge({
    journal: {
      id: bridge.id, sourceChain: "solana", destinationChainId: 88_888,
      sourceMint: bridge.source_mint,
      destinationAsset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      routeType: "OFT", sourceWallet: bridge.source_wallet,
      destinationTreasury: bridge.destination_treasury,
      sourceAmountAtomic: bridge.source_amount_atomic,
      minimumDestinationWei: bridge.minimum_destination_wei,
      quoteId: attempt.quote_id,
      signedTransactionBase64: attempt.signed_transaction_base64,
      signedTransactionSha256: attempt.signed_transaction_sha256,
      sourceSignature: attempt.source_signature,
      bridgeMessageId: bridge.bridge_message_id,
      sourceFinalizedSlot: bridge.source_finalized_slot,
      destinationTxHash: bridge.destination_tx_hash,
    },
    trusted: {
      sourceTokenAccount: plan.sourceTokenAccount,
      sourceEscrow: plan.sourceEscrow,
      minimumDestinationWei: plan.minimumDestinationWei,
      expectedMessageSha256: plan.expectedMessageSha256,
    },
    solanaRpcUrl: input.solanaRpcUrl,
    primaryChilizRpcUrl: input.primaryChilizRpcUrl,
    secondaryChilizRpcUrl: input.secondaryChilizRpcUrl,
    fetchImpl: input.fetchImpl,
  });
  const finalizedBlock = Number(evidence.destination.finalizedBlock);
  if (!Number.isSafeInteger(finalizedBlock) || finalizedBlock <= 0 ||
      evidence.guid !== evidence.source.bridgeMessageId ||
      evidence.guid !== evidence.destination.bridgeMessageId ||
      evidence.destination.destinationTreasury !== bridge.destination_treasury ||
      evidence.destination.receivedWei !== evidence.destination.receivedWei.trim()) {
    fail("repeat_bridge_reconcile_evidence_invalid");
  }
  const txHash = evidence.destination.transactionHash.toLowerCase();
  const sourceJson = JSON.stringify(evidence.source);
  const destinationJson = JSON.stringify({ ...evidence.destination,
    finalizedBlock });
  if (bridge.state === "destination_finalized") {
    if (bridge.destination_tx_hash !== txHash ||
        bridge.destination_received_wei !== evidence.destination.receivedWei ||
        bridge.bridge_message_id !== evidence.guid ||
        bridge.source_finalized_slot !== evidence.source.finalizedSlot) {
      fail("repeat_bridge_reconcile_prior_finality_mismatch");
    }
    return { bridgeId: bridge.id, state: "destination_finalized",
      sourceSignature: attempt.source_signature, destinationTxHash: txHash,
      receivedWei: evidence.destination.receivedWei };
  }
  const statements: D1PreparedStatement[] = [];
  if (bridge.state === "broadcast_unknown" ||
      bridge.state === "held" && bridge.source_finalized_slot === null) {
    statements.push(input.db.prepare(`UPDATE chiliz_bridge_transfers
      SET state='source_finalized',source_finalized_slot=?3,
      source_evidence_json=?4,bridge_message_id=?5,updated_at=CURRENT_TIMESTAMP
      WHERE id=?1 AND source_signature=?2 AND state IN ('broadcast_unknown','held')
        AND source_finalized_slot IS NULL`)
      .bind(bridge.id, attempt.source_signature, evidence.source.finalizedSlot,
        sourceJson, evidence.guid));
  }
  statements.push(input.db.prepare(`UPDATE chiliz_bridge_transfers
      SET state='destination_finalized',destination_tx_hash=?3,
      destination_finalized_block=?4,destination_received_wei=?5,
      destination_evidence_json=?6,updated_at=CURRENT_TIMESTAMP
      WHERE id=?1 AND bridge_message_id=?2 AND state='source_finalized'`)
      .bind(bridge.id, evidence.guid, txHash, finalizedBlock,
        evidence.destination.receivedWei, destinationJson));
  statements.push(input.db.prepare(`INSERT INTO chiliz_bridge_attempts (bridge_id)
    SELECT NULL WHERE NOT EXISTS (
      SELECT 1 FROM chiliz_bridge_transfers b WHERE b.id=?1
        AND b.state='destination_finalized' AND b.source_signature=?2
        AND b.bridge_message_id=?3 AND b.source_finalized_slot=?4
        AND b.destination_tx_hash=?5 AND b.destination_finalized_block=?6
        AND b.destination_received_wei=?7
        AND b.source_evidence_json=?8 AND b.destination_evidence_json=?9
    )`).bind(bridge.id, attempt.source_signature, evidence.guid,
    evidence.source.finalizedSlot, txHash, finalizedBlock,
    evidence.destination.receivedWei, sourceJson, destinationJson));
  const results = await input.db.batch(statements);
  if (results.length !== statements.length || results.some((item) => !item.success) ||
      results.at(-1)?.meta.changes !== 0) fail("repeat_bridge_reconcile_commit_invalid");
  return { bridgeId: bridge.id, state: "destination_finalized",
    sourceSignature: attempt.source_signature, destinationTxHash: txHash,
    receivedWei: evidence.destination.receivedWei };
}
