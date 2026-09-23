import type { Connection, PublicKey } from "@solana/web3.js";

type Rpc = Pick<Connection, "getBlockHeight" | "isBlockhashValid" |
  "getSignatureStatuses" | "getTransaction" | "getSignaturesForAddress">;

/** A missing signature status is not proof of nonexecution. The finalized
 * treasury history must extend through the verified fee-distribution that
 * preceded this order. Any RPC archival gap leaves the order held. */
export async function proveExpiredSwapAbsent(rpc: Rpc, terms: {
  treasury: PublicKey; sourceFeeSignature: string; sourceFeeSlot: number;
  swapSignature: string; swapBlockhash: string; lastValidBlockHeight: number;
}) {
  if (!Number.isSafeInteger(terms.lastValidBlockHeight) || terms.lastValidBlockHeight <= 0 ||
    !Number.isSafeInteger(terms.sourceFeeSlot) || terms.sourceFeeSlot <= 0 ||
    terms.sourceFeeSignature === terms.swapSignature) {
    throw new Error("swap_expiry_terms_invalid");
  }
  const finalizedHeight = await rpc.getBlockHeight("finalized");
  if (finalizedHeight <= terms.lastValidBlockHeight) {
    throw new Error("swap_blockhash_not_expired");
  }
  const [validity, statuses, receipt] = await Promise.all([
    rpc.isBlockhashValid(terms.swapBlockhash, { commitment: "finalized" }),
    rpc.getSignatureStatuses([terms.swapSignature], { searchTransactionHistory: true }),
    rpc.getTransaction(terms.swapSignature,
      { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
  ]);
  if (validity.value || statuses.value[0] || receipt) {
    throw new Error("swap_expiry_receipt_ambiguous");
  }
  let before: string | undefined;
  let previousSlot = Number.MAX_SAFE_INTEGER;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const history = await rpc.getSignaturesForAddress(terms.treasury,
      { limit: 1000, ...(before ? { before } : {}) }, "finalized");
    if (!history.length) break;
    for (const item of history) {
      if (seen.has(item.signature) || !Number.isSafeInteger(item.slot) ||
        item.slot <= 0 || item.slot > previousSlot ||
        item.confirmationStatus !== "finalized") {
        throw new Error("swap_finalized_history_ambiguous");
      }
      seen.add(item.signature);
      previousSlot = item.slot;
      if (item.signature === terms.swapSignature) {
        throw new Error("swap_in_finalized_history");
      }
      if (item.signature === terms.sourceFeeSignature) {
        if (item.slot !== terms.sourceFeeSlot || item.err !== null) {
          throw new Error("swap_fee_anchor_mismatch");
        }
        const [finalStatuses, finalReceipt] = await Promise.all([
          rpc.getSignatureStatuses([terms.swapSignature], { searchTransactionHistory: true }),
          rpc.getTransaction(terms.swapSignature,
            { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
        ]);
        if (finalStatuses.value[0] || finalReceipt) {
          throw new Error("swap_expiry_late_receipt_ambiguous");
        }
        return true;
      }
      if (item.slot < terms.sourceFeeSlot) {
        throw new Error("swap_fee_anchor_missing");
      }
    }
    before = history.at(-1)?.signature;
    if (history.length < 1000) break;
  }
  throw new Error("swap_finalized_history_incomplete");
}
