import type { Connection, PublicKey } from "@solana/web3.js";

type Rpc = Pick<Connection, "getBlockHeight" | "isBlockhashValid" |
  "getSignatureStatuses" | "getTransaction" | "getSignaturesForAddress">;

/** Capture an already finalized transaction touching the source ATA before
 * the claim is sent. Recovery must be able to read back through this exact
 * transaction; an empty or truncated history is never proof of absence. */
export async function captureClaimHistoryAnchor(rpc: Rpc, sourceAta: PublicKey) {
  const history = await rpc.getSignaturesForAddress(sourceAta,
    { limit: 1 }, "finalized");
  const anchor = history[0];
  if (!anchor || anchor.err !== null || anchor.confirmationStatus !== "finalized") {
    throw new Error("claim_history_anchor_unavailable");
  }
  const status = (await rpc.getSignatureStatuses([anchor.signature],
    { searchTransactionHistory: true })).value[0];
  if (!status || status.err !== null || status.confirmationStatus !== "finalized" ||
    status.slot !== anchor.slot) {
    throw new Error("claim_history_anchor_unverified");
  }
  return anchor.signature;
}

/** A null getSignatureStatuses/getTransaction response is insufficient: RPC
 * archival history may be unavailable. The signed SPL transfer necessarily
 * names sourceAta, so absence is proven only when finalized history reaches
 * the anchor saved before broadcasting this exact signed claim. */
export async function proveExpiredClaimTransferAbsent(rpc: Rpc, terms: {
  sourceAta: PublicKey; anchorSignature: string; claimSignature: string;
  claimBlockhash: string; lastValidBlockHeight: number;
}) {
  if (!Number.isSafeInteger(terms.lastValidBlockHeight) ||
    terms.lastValidBlockHeight <= 0 || !terms.anchorSignature ||
    !terms.claimSignature || terms.anchorSignature === terms.claimSignature ||
    !terms.claimBlockhash) throw new Error("claim_expiry_terms_invalid");
  if (await rpc.getBlockHeight("finalized") <= terms.lastValidBlockHeight) {
    throw new Error("claim_blockhash_not_expired");
  }
  const [validity, statuses, receipt] = await Promise.all([
    rpc.isBlockhashValid(terms.claimBlockhash, { commitment: "finalized" }),
    rpc.getSignatureStatuses([terms.claimSignature], { searchTransactionHistory: true }),
    rpc.getTransaction(terms.claimSignature,
      { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
  ]);
  if (validity.value || statuses.value[0] || receipt) {
    throw new Error("claim_expiry_receipt_ambiguous");
  }
  let before: string | undefined;
  const seen = new Set<string>();
  let previousSlot = Number.MAX_SAFE_INTEGER;
  for (let page = 0; page < 10; page += 1) {
    const history = await rpc.getSignaturesForAddress(terms.sourceAta,
      { limit: 1000, ...(before ? { before } : {}) }, "finalized");
    if (!history.length) break;
    for (const item of history) {
      if (seen.has(item.signature) || item.slot > previousSlot ||
        item.confirmationStatus !== "finalized") {
        throw new Error("claim_history_ambiguous");
      }
      seen.add(item.signature);
      previousSlot = item.slot;
      if (item.signature === terms.claimSignature) {
        throw new Error("claim_in_finalized_history");
      }
      if (item.signature === terms.anchorSignature) {
        if (item.err !== null) throw new Error("claim_history_anchor_failed");
        const [finalStatuses, finalReceipt] = await Promise.all([
          rpc.getSignatureStatuses([terms.claimSignature],
            { searchTransactionHistory: true }),
          rpc.getTransaction(terms.claimSignature,
            { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
        ]);
        if (finalStatuses.value[0] || finalReceipt) {
          throw new Error("claim_expiry_late_receipt_ambiguous");
        }
        return true;
      }
    }
    before = history.at(-1)?.signature;
    if (history.length < 1000) break;
  }
  throw new Error("claim_history_incomplete");
}
