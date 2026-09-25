import { createPublicClient, http } from "viem";
import type { AfcBuyCanaryIntent } from "./chiliz-v2-buy-canary-intent.ts";
import { purchasedTokenOutput, waitForFinalizedChilizReceipt } from
  "../../../scripts/chiliz-worker-intent.mjs";

export type AfcBuyCanaryReceiptProof = Readonly<{
  txHash: string;
  receiptStatus: "success" | "reverted";
  receiptBlockHash: string;
  receiptBlockNumber: number;
  finalizedBlockNumber: number;
  outputAmountAtomic: string;
}>;

function rpcUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("afc_v2_canary_receipt_rpc_invalid"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    throw new Error("afc_v2_canary_receipt_rpc_invalid");
  }
  return url;
}

/** Dual-independent-RPC validator finality, canonical signed transaction and
 * receipt, plus an AFC Transfer event to the treasury above the signed min.
 * No balance-only or latest-block inference is accepted. */
export async function verifyAfcV2BuyCanaryReceipt(input: {
  intent: AfcBuyCanaryIntent;
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
}): Promise<AfcBuyCanaryReceiptProof> {
  const primary = rpcUrl(input.primaryRpcUrl);
  const secondary = rpcUrl(input.secondaryRpcUrl);
  if (primary.origin === secondary.origin) {
    throw new Error("afc_v2_canary_receipt_rpcs_not_independent");
  }
  const chain = {
    id: 88_888, name: "Chiliz Chain",
    nativeCurrency: { name: "Chiliz", symbol: "CHZ", decimals: 18 },
    rpcUrls: { default: { http: [primary.href] } },
  } as const;
  const first = createPublicClient({ chain, transport: http(primary.href,
    { timeout: 10_000, retryCount: 0 }) });
  const second = createPublicClient({ chain: { ...chain,
    rpcUrls: { default: { http: [secondary.href] } } },
    transport: http(secondary.href, { timeout: 10_000, retryCount: 0 }) });
  const proof = await waitForFinalizedChilizReceipt(input.intent, first, second,
    { timeoutMs: 20_000, pollMs: 2_000, allowReverted: true, returnProof: true });
  const receipt = proof.receipt;
  const status = receipt.status;
  if (status !== "success" && status !== "reverted" ||
      receipt.transactionHash.toLowerCase() !== input.intent.txHash.toLowerCase() ||
      !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)) {
    throw new Error("afc_v2_canary_receipt_invalid");
  }
  const receiptBlockNumber = Number(receipt.blockNumber);
  const finalizedBlockNumber = Number(proof.finalizedBlockNumber);
  if (!Number.isSafeInteger(receiptBlockNumber) || receiptBlockNumber <= 0 ||
      !Number.isSafeInteger(finalizedBlockNumber) ||
      finalizedBlockNumber < receiptBlockNumber) {
    throw new Error("afc_v2_canary_receipt_height_invalid");
  }
  const outputAmountAtomic = status === "success" ?
    purchasedTokenOutput(input.intent, receipt) : "0";
  return {
    txHash: input.intent.txHash.toLowerCase(), receiptStatus: status,
    receiptBlockHash: receipt.blockHash.toLowerCase(), receiptBlockNumber,
    finalizedBlockNumber, outputAmountAtomic,
  };
}
