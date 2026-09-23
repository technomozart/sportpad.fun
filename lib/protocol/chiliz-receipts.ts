import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";

export const CHILIZ_CHAIN_ID = 88_888;
// Chiliz migrated Fan Tokens to 18-decimal V2 contracts in Q2 2026. Keep
// execution held until direct V2 routes and receipt checks pass funded canaries.
// https://docs.chiliz.com/learn/about-fan-tokens/2026-migration-to-decimal-fan-tokens
export const CHILIZ_ASSET_MIGRATION_VERIFIED = false;
export const KAYEN_ROUTER = "0x1918EbB39492C8b98865c5E53219c3f1AE79e76F";
export const WRAPPED_CHZ = "0x677F7e16C7Dd57be1D4C8aD1244883214953DC47";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ROUTER_ABI = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const ERC20_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

type Log = { address: string; topics: readonly string[]; data: string };
export type ChilizTransactionEvidence = {
  hash: string; from: string; to: string | null; input: string; value: bigint;
  chainId?: number | null; blockHash: string | null; blockNumber: bigint | null;
};
export type ChilizReceiptEvidence = {
  transactionHash: string; status: string; blockHash: string; blockNumber: bigint;
  logs: readonly Log[];
};
export type ChilizChainEvidence = {
  chainId: number; latestBlock: bigint; tokenDecimals: number;
  transaction: ChilizTransactionEvidence; receipt: ChilizReceiptEvidence;
};

function fail(code: string): never { throw new Error(code); }
function sameAddress(a: string | null | undefined, b: string) {
  return Boolean(a && /^0x[0-9a-fA-F]{40}$/.test(a) && a.toLowerCase() === b.toLowerCase());
}
function positiveAtomic(value: string) {
  if (!/^[1-9][0-9]*$/.test(value)) fail("chiliz_amount_invalid");
  return BigInt(value);
}

function confirmed(evidence: ChilizChainEvidence, txHash: string, treasury: string) {
  const { chainId, latestBlock, transaction: tx, receipt } = evidence;
  if (chainId !== CHILIZ_CHAIN_ID || tx.chainId !== CHILIZ_CHAIN_ID) fail("chiliz_chain_mismatch");
  if (tx.hash.toLowerCase() !== txHash.toLowerCase() ||
    receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) fail("chiliz_hash_mismatch");
  if (receipt.status !== "success" || !tx.blockHash || tx.blockNumber === null ||
    tx.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    tx.blockNumber !== receipt.blockNumber || latestBlock < receipt.blockNumber + 1n) {
    fail("chiliz_transaction_not_confirmed");
  }
  if (!sameAddress(tx.from, treasury)) fail("chiliz_treasury_mismatch");
}

function transferDelta(logs: readonly Log[], token: string, holder: string) {
  let incoming = 0n;
  let outgoing = 0n;
  for (const log of logs) {
    if (!sameAddress(log.address, token) || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics.length !== 3 || !/^0x0{24}[0-9a-fA-F]{40}$/.test(log.topics[1]) ||
      !/^0x0{24}[0-9a-fA-F]{40}$/.test(log.topics[2]) || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) {
      fail("chiliz_transfer_log_invalid");
    }
    const from = `0x${log.topics[1].slice(26)}`;
    const to = `0x${log.topics[2].slice(26)}`;
    const amount = BigInt(log.data);
    if (sameAddress(to, holder)) incoming += amount;
    if (sameAddress(from, holder)) outgoing += amount;
  }
  return incoming - outgoing;
}

export function verifyChilizPurchaseReceipt(evidence: ChilizChainEvidence, expected: {
  txHash: string; treasury: string; fanTokenContract: string; outputAmountAtomic: string;
}) {
  confirmed(evidence, expected.txHash, expected.treasury);
  if (evidence.tokenDecimals !== 18) fail("chiliz_v2_decimals_mismatch");
  const tx = evidence.transaction;
  if (!sameAddress(tx.to, KAYEN_ROUTER) || tx.value <= 0n) fail("chiliz_purchase_target_or_value_mismatch");
  let minimum: bigint;
  try {
    const decoded = decodeFunctionData({ abi: ROUTER_ABI, data: tx.input as `0x${string}` });
    if (decoded.functionName !== "swapExactETHForTokens") fail("chiliz_purchase_function_mismatch");
    const [amountOutMin, path, recipient, deadline] = decoded.args;
    if (path.length !== 2 || !sameAddress(path[0], WRAPPED_CHZ) ||
      !sameAddress(path[1], expected.fanTokenContract) ||
      !sameAddress(recipient, expected.treasury) || amountOutMin <= 0n || deadline <= 0n) {
      fail("chiliz_purchase_calldata_mismatch");
    }
    if (encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactETHForTokens",
      args: [amountOutMin, path, recipient, deadline] }).toLowerCase() !== tx.input.toLowerCase()) {
      fail("chiliz_purchase_calldata_noncanonical");
    }
    minimum = amountOutMin;
  } catch { return fail("chiliz_purchase_calldata_invalid"); }
  const acquired = transferDelta(evidence.receipt.logs, expected.fanTokenContract, expected.treasury);
  if (acquired <= 0n || acquired < minimum || acquired !== positiveAtomic(expected.outputAmountAtomic)) {
    fail("chiliz_purchase_output_mismatch");
  }
  return { acquiredAtomic: acquired, spentChzWei: tx.value };
}

export function verifyChilizTransferReceipt(evidence: ChilizChainEvidence, expected: {
  txHash: string; treasury: string; destination: string; fanTokenContract: string; amountAtomic: string;
}) {
  confirmed(evidence, expected.txHash, expected.treasury);
  if (evidence.tokenDecimals !== 18) fail("chiliz_v2_decimals_mismatch");
  const tx = evidence.transaction;
  if (!sameAddress(tx.to, expected.fanTokenContract) || tx.value !== 0n) fail("chiliz_transfer_target_or_value_mismatch");
  const amount = positiveAtomic(expected.amountAtomic);
  try {
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: tx.input as `0x${string}` });
    if (decoded.functionName !== "transfer") fail("chiliz_transfer_function_mismatch");
    const [destination, submittedAmount] = decoded.args;
    if (!sameAddress(destination, expected.destination) || submittedAmount !== amount) {
      fail("chiliz_transfer_calldata_mismatch");
    }
    if (encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer",
      args: [destination, submittedAmount] }).toLowerCase() !== tx.input.toLowerCase()) {
      fail("chiliz_transfer_calldata_noncanonical");
    }
  } catch { return fail("chiliz_transfer_calldata_invalid"); }
  const delivered = transferDelta(evidence.receipt.logs, expected.fanTokenContract, expected.destination);
  const debited = transferDelta(evidence.receipt.logs, expected.fanTokenContract, expected.treasury);
  if (delivered !== amount || debited !== -amount) fail("chiliz_transfer_delivery_mismatch");
  return { deliveredAtomic: delivered };
}
