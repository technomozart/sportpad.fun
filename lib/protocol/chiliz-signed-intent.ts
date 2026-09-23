import { encodeFunctionData, getAddress, isAddress, keccak256, parseAbi,
  parseTransaction, recoverTransactionAddress, serializeTransaction } from "viem";
import type { Address } from "viem";
import { CHILIZ_CHAIN_ID, KAYEN_ROUTER, WRAPPED_CHZ } from "./chiliz-receipts.ts";

const CHZ_WEI = 10n ** 18n;
const MAX_PURCHASE_VALUE_WEI = 1_000n * CHZ_WEI;
const MAX_PURCHASE_NETWORK_FEE_WEI = 3n * CHZ_WEI;
const MAX_CLAIM_NETWORK_FEE_WEI = CHZ_WEI;
const MAX_GAS_LIMIT = 1_000_000n;
const MAX_RAW_HEX_LENGTH = 10_000;
const ROUTER_ABI = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const ERC20_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

type BaseRequest = {
  jobId: string;
  attempt: 1;
  treasury: string;
  rawTransaction: `0x${string}`;
  gasFeeCeilingWei: string;
};
export type ChilizSignedIntentRequest = BaseRequest & (
  | { kind: "purchase"; fanTokenContract: string; maxPrincipalWei: string;
      minimumOutputAtomic: string; deadlineEpochSeconds: number; signedAtEpochSeconds: number }
  | { kind: "claim"; fanTokenContract: string; destination: string; amountAtomic: string }
);

/** Server-side, JSON-safe record to commit atomically before sendRawTransaction. */
export type ChilizSignedIntent = ChilizSignedIntentRequest & {
  txHash: `0x${string}`;
  nonce: number;
  valueWei: string;
  gasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  maximumNetworkFeeWei: string;
  maximumTotalSpendWei: string;
};

export type ChilizReconciliationEvidence = {
  chainId: number;
  transaction?: null | {
    hash: string; from: string; to: string | null; input: string; value: bigint;
    chainId?: number | null; nonce: number; gas: bigint; maxFeePerGas?: bigint | null;
    maxPriorityFeePerGas?: bigint | null; type: string;
    blockHash: string | null; blockNumber: bigint | null;
  };
  receipt?: null | {
    transactionHash: string; status: string; blockHash: string; blockNumber: bigint;
    gasUsed: bigint; effectiveGasPrice: bigint;
  };
  /** Hash of the canonical block fetched independently at receipt.blockNumber. */
  canonicalReceiptBlockHash?: string | null;
  /** Number obtained from the chain's finalized block tag, not latest/safe. */
  finalizedBlockNumber?: bigint | null;
};

function fail(code: string): never { throw new Error(code); }
function atomic(value: string, code: string, allowZero = false): bigint {
  if (typeof value !== "string" || !(allowZero ? /^(?:0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) fail(code);
  return BigInt(value);
}
function address(value: string, code: string): Address {
  if (typeof value !== "string" || !isAddress(value)) fail(code);
  return getAddress(value);
}
function equalAddress(a: string | null | undefined, b: string): boolean {
  return Boolean(a && isAddress(a) && getAddress(a) === getAddress(b));
}
function equalHex(a: string | null | undefined, b: string): boolean {
  return Boolean(a && /^0x[0-9a-fA-F]+$/.test(a) && a.toLowerCase() === b.toLowerCase());
}

export async function createChilizSignedIntent(request: ChilizSignedIntentRequest): Promise<ChilizSignedIntent> {
  if (!request || !/^[a-zA-Z0-9:_-]{1,128}$/.test(request.jobId) || request.attempt !== 1) fail("chiliz_intent_job_invalid");
  const treasury = address(request.treasury, "chiliz_intent_treasury_invalid");
  const token = address(request.fanTokenContract, "chiliz_intent_token_invalid");
  const gasFeeCeiling = atomic(request.gasFeeCeilingWei, "chiliz_intent_fee_ceiling_invalid");
  const hardFeeCap = request.kind === "purchase" ? MAX_PURCHASE_NETWORK_FEE_WEI : MAX_CLAIM_NETWORK_FEE_WEI;
  if (gasFeeCeiling > hardFeeCap) fail("chiliz_intent_fee_ceiling_exceeded");
  const raw = request.rawTransaction;
  if (typeof raw !== "string" || raw.length > MAX_RAW_HEX_LENGTH || !/^0x(?:[0-9a-fA-F]{2})+$/.test(raw)) {
    fail("chiliz_intent_raw_invalid");
  }
  let tx: ReturnType<typeof parseTransaction>;
  try { tx = parseTransaction(raw); } catch { return fail("chiliz_intent_raw_invalid"); }
  if (tx.type !== "eip1559" || tx.chainId !== CHILIZ_CHAIN_ID ||
      tx.accessList?.length || tx.nonce === undefined || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0 ||
      !tx.to || !tx.data || !tx.gas || !tx.maxFeePerGas ||
      tx.maxPriorityFeePerGas === undefined || tx.maxPriorityFeePerGas > tx.maxFeePerGas ||
      tx.gas > MAX_GAS_LIMIT) fail("chiliz_intent_transaction_invalid");
  if (serializeTransaction(tx).toLowerCase() !== raw.toLowerCase()) fail("chiliz_intent_noncanonical_raw");
  let recovered: string;
  try { recovered = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` }); }
  catch { return fail("chiliz_intent_signature_invalid"); }
  if (!equalAddress(recovered, treasury)) fail("chiliz_intent_signer_mismatch");
  const maximumNetworkFee = tx.gas * tx.maxFeePerGas;
  const value = tx.value ?? 0n;
  if (maximumNetworkFee > gasFeeCeiling) fail("chiliz_intent_network_fee_exceeded");

  let expectedTo: Address;
  let expectedData: `0x${string}`;
  let principalCeiling: bigint;
  if (request.kind === "purchase") {
    principalCeiling = atomic(request.maxPrincipalWei, "chiliz_intent_principal_invalid");
    const minOut = atomic(request.minimumOutputAtomic, "chiliz_intent_minimum_invalid");
    if (principalCeiling > MAX_PURCHASE_VALUE_WEI || value <= 0n || value > principalCeiling) {
      fail("chiliz_intent_principal_exceeded");
    }
    if (!Number.isSafeInteger(request.signedAtEpochSeconds) ||
        !Number.isSafeInteger(request.deadlineEpochSeconds) ||
        request.deadlineEpochSeconds <= request.signedAtEpochSeconds ||
        request.deadlineEpochSeconds - request.signedAtEpochSeconds > 180) {
      fail("chiliz_intent_deadline_invalid");
    }
    expectedTo = KAYEN_ROUTER;
    expectedData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactETHForTokens",
      args: [minOut, [WRAPPED_CHZ, token], treasury, BigInt(request.deadlineEpochSeconds)] });
  } else if (request.kind === "claim") {
    principalCeiling = 0n;
    const destination = address(request.destination, "chiliz_intent_destination_invalid");
    const amount = atomic(request.amountAtomic, "chiliz_intent_amount_invalid");
    if (value !== 0n) fail("chiliz_intent_claim_value_nonzero");
    expectedTo = token;
    expectedData = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [destination, amount] });
  } else {
    return fail("chiliz_intent_kind_invalid");
  }
  if (!equalAddress(tx.to, expectedTo) || !equalHex(tx.data, expectedData)) fail("chiliz_intent_call_mismatch");
  const hash = keccak256(raw);
  return {
    ...request, rawTransaction: raw.toLowerCase() as `0x${string}`, txHash: hash,
    nonce: tx.nonce, valueWei: value.toString(), gasLimit: tx.gas.toString(),
    maxFeePerGasWei: tx.maxFeePerGas.toString(),
    maxPriorityFeePerGasWei: tx.maxPriorityFeePerGas.toString(),
    maximumNetworkFeeWei: maximumNetworkFee.toString(),
    maximumTotalSpendWei: (value + maximumNetworkFee).toString(),
  };
}

/** Re-derive signed fields rather than trusting a mutable stored JSON envelope. */
export async function verifyPersistedChilizSignedIntent(intent: ChilizSignedIntent): Promise<ChilizSignedIntent> {
  const derived = await createChilizSignedIntent(intent);
  for (const key of ["txHash", "nonce", "valueWei", "gasLimit", "maxFeePerGasWei",
    "maxPriorityFeePerGasWei", "maximumNetworkFeeWei", "maximumTotalSpendWei"] as const) {
    if (derived[key] !== intent[key]) fail("chiliz_intent_persisted_mismatch");
  }
  return derived;
}

/** Read-only transaction proof, not token-delivery settlement. No result authorizes a second spend. */
export async function reconcileChilizSignedIntent(intent: ChilizSignedIntent,
  evidence: ChilizReconciliationEvidence): Promise<
    | { state: "unresolved"; txHash: string; retryAllowed: false; settlementAllowed: false }
    | { state: "finalized_success" | "finalized_reverted"; txHash: string;
        networkFeeWei: string; principalSpentWei: string; totalSpentWei: string;
        retryAllowed: false; settlementAllowed: false }
  > {
  const verified = await verifyPersistedChilizSignedIntent(intent);
  if (evidence.chainId !== CHILIZ_CHAIN_ID) fail("chiliz_reconcile_chain_mismatch");
  const tx = evidence.transaction;
  if (tx) {
    if (!equalHex(tx.hash, verified.txHash) || !equalAddress(tx.from, verified.treasury) ||
        !equalAddress(tx.to, verified.kind === "purchase" ? KAYEN_ROUTER : verified.fanTokenContract) ||
        !equalHex(tx.input, parseTransaction(verified.rawTransaction).data ?? "0x") ||
        tx.chainId !== CHILIZ_CHAIN_ID || tx.type !== "eip1559" || tx.nonce !== verified.nonce ||
        tx.value.toString() !== verified.valueWei || tx.gas.toString() !== verified.gasLimit ||
        tx.maxFeePerGas?.toString() !== verified.maxFeePerGasWei ||
        tx.maxPriorityFeePerGas?.toString() !== verified.maxPriorityFeePerGasWei) {
      fail("chiliz_reconcile_transaction_mismatch");
    }
  }
  const receipt = evidence.receipt;
  if (!receipt) return { state: "unresolved", txHash: verified.txHash,
    retryAllowed: false, settlementAllowed: false };
  if (!equalHex(receipt.transactionHash, verified.txHash)) fail("chiliz_reconcile_receipt_mismatch");
  if (!tx || !tx.blockHash || tx.blockNumber === null ||
      !equalHex(tx.blockHash, receipt.blockHash) || tx.blockNumber !== receipt.blockNumber ||
      !evidence.canonicalReceiptBlockHash ||
      !equalHex(evidence.canonicalReceiptBlockHash, receipt.blockHash) ||
      evidence.finalizedBlockNumber === null || evidence.finalizedBlockNumber === undefined ||
      evidence.finalizedBlockNumber < receipt.blockNumber) {
    return { state: "unresolved", txHash: verified.txHash,
      retryAllowed: false, settlementAllowed: false };
  }
  if (receipt.status !== "success" && receipt.status !== "reverted") fail("chiliz_reconcile_status_invalid");
  const gasLimit = BigInt(verified.gasLimit);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  if (receipt.gasUsed < 0n || receipt.gasUsed > gasLimit || receipt.effectiveGasPrice < 0n ||
      receipt.effectiveGasPrice > BigInt(verified.maxFeePerGasWei) ||
      fee > BigInt(verified.gasFeeCeilingWei)) fail("chiliz_reconcile_fee_exceeded");
  const principal = receipt.status === "success" ? BigInt(verified.valueWei) : 0n;
  return { state: receipt.status === "success" ? "finalized_success" : "finalized_reverted",
    txHash: verified.txHash, networkFeeWei: fee.toString(), principalSpentWei: principal.toString(),
    totalSpentWei: (principal + fee).toString(), retryAllowed: false, settlementAllowed: false };
}
