import { Buffer } from "node:buffer";
import type { ChilizBridgeJournalInsert } from "../chiliz-bridge-journal.ts";
import type { UnsignedDirectOftChzTransfer } from "./chiliz-direct-oft-build.ts";
import { prepareDirectOftChilizBridgeJournalInsert } from "./chiliz-direct-oft-journal.ts";
import {
  reconcileDirectOftChilizBridge, type PreparedDirectOftJournalRow,
  type ReconciledDirectOftEvidence,
} from "./direct-oft-reconcile.ts";

/** Solana Labs' published mainnet-beta genesis hash. */
const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SOURCE_MINT = "6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw";
const DESTINATION_ASSET = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** SELECT_CHILIZ_BRIDGE_SQL must be used to load the reserved row. */
export type PersistedDirectOftBroadcastRow = PreparedDirectOftJournalRow & Readonly<{
  policyKey: string;
  quoteExpiresAtMs: number;
  state: "prepared" | "broadcast_attempted" | "source_finalized" |
    "destination_finalized" | "held";
  broadcastAttemptedAtMs: number | null;
}>;

export type DirectOftBroadcastRpc = {
  getGenesisHash(): Promise<string>;
  getBlockHeight(commitment: "confirmed"): Promise<number>;
  getSignatureStatuses(signatures: string[], options: {
    searchTransactionHistory: true;
  }): Promise<{ value: Array<{
    err: unknown; confirmationStatus: string | null;
  } | null> }>;
  sendRawTransaction(rawTransaction: Uint8Array, options: {
    skipPreflight: false; maxRetries: 0;
  }): Promise<string>;
};

export type DirectOftBroadcastOutcome =
  | { state: "delivered"; evidence: ReconciledDirectOftEvidence }
  | { state: "submitted_pending" | "broadcast_unknown" |
      "reconciliation_pending" | "failed_on_chain";
      journalId: string; sourceSignature: string };

function fail(code: string): never { throw new Error(code); }

function identityMatches(row: PersistedDirectOftBroadcastRow,
  intent: ChilizBridgeJournalInsert): boolean {
  return row.id === intent.id && row.policyKey === "initial" &&
    row.sourceChain === "solana" && row.destinationChainId === 88_888 &&
    row.sourceMint === SOURCE_MINT && row.destinationAsset === DESTINATION_ASSET &&
    row.routeType === "OFT" && intent.routeType === "OFT" &&
    row.sourceWallet === intent.sourceWallet &&
    row.destinationTreasury === intent.destinationTreasury &&
    row.sourceAmountAtomic === intent.sourceAmountAtomic &&
    row.minimumDestinationWei === intent.minimumDestinationWei &&
    row.quoteId === intent.quoteId &&
    row.quoteExpiresAtMs === intent.quoteExpiresAtMs &&
    row.signedTransactionBase64 === intent.signedTransactionBase64 &&
    row.signedTransactionSha256 === intent.signedTransactionSha256 &&
    row.sourceSignature === intent.sourceSignature;
}

function persistedBytes(row: PersistedDirectOftBroadcastRow): Uint8Array {
  const base64 = row.signedTransactionBase64;
  if (typeof base64 !== "string" || !BASE64.test(base64)) {
    fail("direct_oft_broadcast_signed_bytes_invalid");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 100 || bytes.length > 1_232 || bytes.toString("base64") !== base64) {
    fail("direct_oft_broadcast_signed_bytes_invalid");
  }
  return Uint8Array.from(bytes);
}

async function status(rpc: DirectOftBroadcastRpc, signature: string): Promise<{
  err: unknown; confirmationStatus: string | null;
} | null> {
  let response: Awaited<ReturnType<DirectOftBroadcastRpc["getSignatureStatuses"]>>;
  try { response = await rpc.getSignatureStatuses([signature],
    { searchTransactionHistory: true }); }
  catch { return fail("direct_oft_broadcast_status_unavailable"); }
  if (!response || !Array.isArray(response.value) || response.value.length !== 1) {
    fail("direct_oft_broadcast_status_invalid");
  }
  const result = response.value[0];
  if (result !== null && (typeof result !== "object" ||
      !["processed", "confirmed", "finalized"].includes(
        String(result.confirmationStatus)))) {
    fail("direct_oft_broadcast_status_invalid");
  }
  return result;
}

/** Reconcile a previously claimed/held row by signature; never rebroadcast. */
export async function reconcileClaimedDirectOftBroadcast(input: {
  journal: PersistedDirectOftBroadcastRow;
  plan: UnsignedDirectOftChzTransfer;
  solanaRpcUrl: string;
  primaryChilizRpcUrl: string;
  secondaryChilizRpcUrl: string;
  fetchImpl?: RpcFetch;
}): Promise<ReconciledDirectOftEvidence> {
  if (!["broadcast_attempted", "source_finalized", "destination_finalized", "held"]
    .includes(input.journal.state) ||
      input.journal.broadcastAttemptedAtMs === null ||
      !Number.isSafeInteger(input.journal.broadcastAttemptedAtMs) ||
      input.journal.broadcastAttemptedAtMs <= 0 ||
      input.journal.minimumDestinationWei !== input.plan.minimumDestinationWei ||
      input.journal.quoteId !== `oft:${input.plan.onchainQuoteDigestSha256}`) {
    fail("direct_oft_broadcast_reconciliation_identity_invalid");
  }
  return reconcileDirectOftChilizBridge({
    journal: input.journal,
    trusted: {
      sourceTokenAccount: input.plan.sourceTokenAccount,
      sourceEscrow: input.plan.sourceEscrow,
      minimumDestinationWei: input.plan.minimumDestinationWei,
      expectedMessageSha256: input.plan.expectedMessageSha256,
    },
    solanaRpcUrl: input.solanaRpcUrl,
    primaryChilizRpcUrl: input.primaryChilizRpcUrl,
    secondaryChilizRpcUrl: input.secondaryChilizRpcUrl,
    fetchImpl: input.fetchImpl,
  });
}

async function outcomeFromStatus(input: {
  journal: PersistedDirectOftBroadcastRow;
  plan: UnsignedDirectOftChzTransfer;
  rpcStatus: { err: unknown; confirmationStatus: string | null } | null;
  sentSignature: string | null;
  solanaRpcUrl: string;
  primaryChilizRpcUrl: string;
  secondaryChilizRpcUrl: string;
  fetchImpl?: RpcFetch;
}): Promise<DirectOftBroadcastOutcome> {
  const base = { journalId: input.journal.id,
    sourceSignature: input.journal.sourceSignature };
  if (input.rpcStatus?.err != null) return { state: "failed_on_chain", ...base };
  if (input.rpcStatus?.confirmationStatus !== "finalized") {
    return { state: input.sentSignature === input.journal.sourceSignature ?
      "submitted_pending" : "broadcast_unknown", ...base };
  }
  try {
    const evidence = await reconcileClaimedDirectOftBroadcast(input);
    return { state: "delivered", evidence };
  } catch {
    // A finalized source can precede Scan indexing or destination finality.
    // Never replay the source transaction to repair a reconciliation failure.
    return { state: "reconciliation_pending", ...base };
  }
}

/**
 * One shot only. `loadPersisted` must independently SELECT the reserved row;
 * `claimBroadcastAttempt` must atomically run MARK_CHILIZ_BRIDGE_BROADCAST_SQL
 * and report exactly one changed row. That one-way DB transition is the
 * durable replay fence. Unknown send outcomes are reconciled by signature,
 * never retried here. No signer, DB implementation, or policy activation is
 * present in this module.
 */
export async function broadcastDirectOftChilizOnce(input: {
  expectedJournal: ChilizBridgeJournalInsert;
  plan: UnsignedDirectOftChzTransfer;
  loadPersisted: (id: string) => Promise<PersistedDirectOftBroadcastRow | null>;
  claimBroadcastAttempt: (id: string, sourceSignature: string, nowMs: number) =>
    Promise<{ changedRows: number; journal: PersistedDirectOftBroadcastRow | null }>;
  rpc: DirectOftBroadcastRpc;
  solanaRpcUrl: string;
  primaryChilizRpcUrl: string;
  secondaryChilizRpcUrl: string;
  fetchImpl?: RpcFetch;
  nowMs?: number;
}): Promise<DirectOftBroadcastOutcome> {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) fail("direct_oft_broadcast_time_invalid");
  let persisted: PersistedDirectOftBroadcastRow | null;
  try { persisted = await input.loadPersisted(input.expectedJournal.id); }
  catch { return fail("direct_oft_broadcast_journal_unavailable"); }
  if (!persisted || !identityMatches(persisted, input.expectedJournal) ||
      persisted.state !== "prepared" || persisted.broadcastAttemptedAtMs !== null) {
    fail("direct_oft_broadcast_persisted_identity_invalid");
  }
  const independentlyChecked = await prepareDirectOftChilizBridgeJournalInsert({
    id: input.expectedJournal.id,
    plan: input.plan,
    expectedSourceWallet: input.expectedJournal.sourceWallet,
    expectedDestinationTreasury: input.expectedJournal.destinationTreasury,
    signedTransactionBase64: persisted.signedTransactionBase64,
    nowMs,
  });
  if (!identityMatches(persisted, independentlyChecked)) {
    fail("direct_oft_broadcast_plan_mismatch");
  }
  const bytes = persistedBytes(persisted);
  let genesis: string;
  let height: number;
  try {
    [genesis, height] = await Promise.all([
      input.rpc.getGenesisHash(), input.rpc.getBlockHeight("confirmed"),
    ]);
  } catch { return fail("direct_oft_broadcast_rpc_unavailable"); }
  if (genesis !== SOLANA_MAINNET_GENESIS || !Number.isSafeInteger(height) || height <= 0) {
    fail("direct_oft_broadcast_wrong_chain_or_height");
  }
  if (height + 10 >= input.plan.lastValidBlockHeight ||
      persisted.quoteExpiresAtMs <= nowMs + 30_000) {
    fail("direct_oft_broadcast_expired");
  }
  const before = await status(input.rpc, persisted.sourceSignature);
  let claim: { changedRows: number; journal: PersistedDirectOftBroadcastRow | null };
  try {
    claim = await input.claimBroadcastAttempt(persisted.id, persisted.sourceSignature, nowMs);
  } catch { return fail("direct_oft_broadcast_claim_unavailable"); }
  if (!claim || claim.changedRows !== 1 || !claim.journal ||
      !identityMatches(claim.journal, independentlyChecked) ||
      claim.journal.state !== "broadcast_attempted" ||
      claim.journal.broadcastAttemptedAtMs === null ||
      Math.abs(claim.journal.broadcastAttemptedAtMs - nowMs) > 30_000) {
    fail("direct_oft_broadcast_claim_invalid");
  }
  const claimed = claim.journal;
  if (before !== null) {
    return outcomeFromStatus({ ...input, journal: claimed, rpcStatus: before,
      sentSignature: null });
  }
  // Recheck after the durable marker: a slow claim must not send an expired tx.
  let latestHeight: number;
  try { latestHeight = await input.rpc.getBlockHeight("confirmed"); }
  catch { return { state: "broadcast_unknown", journalId: claimed.id,
    sourceSignature: claimed.sourceSignature }; }
  if (!Number.isSafeInteger(latestHeight) || latestHeight + 10 >= input.plan.lastValidBlockHeight ||
      claimed.quoteExpiresAtMs <= (input.nowMs ?? Date.now()) + 30_000) {
    return { state: "broadcast_unknown", journalId: claimed.id,
      sourceSignature: claimed.sourceSignature };
  }
  let sentSignature: string | null = null;
  try {
    sentSignature = await input.rpc.sendRawTransaction(Uint8Array.from(bytes),
      { skipPreflight: false, maxRetries: 0 });
  } catch { /* Outcome unknown; only the persisted signature may be reconciled. */ }
  let after: Awaited<ReturnType<typeof status>>;
  try { after = await status(input.rpc, claimed.sourceSignature); }
  catch { return { state: "broadcast_unknown", journalId: claimed.id,
    sourceSignature: claimed.sourceSignature }; }
  return outcomeFromStatus({ ...input, journal: claimed, rpcStatus: after,
    sentSignature });
}
