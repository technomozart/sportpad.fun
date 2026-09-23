import type { Connection, PublicKey } from "@solana/web3.js";

type Rpc = Pick<Connection, "getBlockHeight" | "isBlockhashValid" |
  "getSignatureStatuses" | "getTransaction" | "getSignaturesForAddress">;

/** An absent status alone is not nonexecution proof: RPC status caches and
 * history can be incomplete. Fail closed unless finalized address history is
 * continuous all the way back through the verified source swap. The burn
 * touches this ATA, so a finalized burn must appear in that history. */
export async function proveExpiredBuybackBurnAbsent(rpc: Rpc, terms: {
  sourceAta: PublicKey; sourceSwapSignature: string; burnSignature: string;
  burnBlockhash: string; lastValidBlockHeight: number;
}) {
  if (!Number.isSafeInteger(terms.lastValidBlockHeight) || terms.lastValidBlockHeight <= 0 ||
    terms.sourceSwapSignature === terms.burnSignature) {
    throw new Error("buyback_burn_expiry_terms_invalid");
  }
  const finalizedHeight = await rpc.getBlockHeight("finalized");
  if (finalizedHeight <= terms.lastValidBlockHeight) {
    throw new Error("buyback_burn_blockhash_not_expired");
  }
  const [validity, statuses, receipt] = await Promise.all([
    rpc.isBlockhashValid(terms.burnBlockhash, { commitment: "finalized" }),
    rpc.getSignatureStatuses([terms.burnSignature], { searchTransactionHistory: true }),
    rpc.getTransaction(terms.burnSignature,
      { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
  ]);
  if (validity.value || statuses.value[0] || receipt) {
    throw new Error("buyback_burn_expiry_receipt_ambiguous");
  }
  let before: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 10; page += 1) {
    const history = await rpc.getSignaturesForAddress(terms.sourceAta,
      { limit: 1000, ...(before ? { before } : {}) }, "finalized");
    if (!history.length) break;
    for (const item of history) {
      if (seen.has(item.signature)) throw new Error("buyback_burn_history_duplicate");
      seen.add(item.signature);
      if (item.signature === terms.burnSignature) {
        throw new Error("buyback_burn_in_finalized_history");
      }
      if (item.signature === terms.sourceSwapSignature) return true;
    }
    before = history.at(-1)?.signature;
    if (history.length < 1000) break;
  }
  throw new Error("buyback_burn_history_incomplete");
}
