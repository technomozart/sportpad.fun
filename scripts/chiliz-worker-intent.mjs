import { decodeEventLog, getAddress, isAddress, keccak256, parseAbi } from "viem";
import { createChilizSignedIntent, reconcileChilizSignedIntent,
  verifyPersistedChilizSignedIntent } from "../lib/protocol/chiliz-signed-intent.ts";
import { CHILIZ_CHAIN_ID } from "../lib/protocol/chiliz-receipts.ts";

const ERC20 = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const MAX_GAS_LIMIT = 1_000_000n;
const MAX_PURCHASE_FEE_WEI = 3n * 10n ** 18n;
const MAX_CLAIM_FEE_WEI = 10n ** 18n;

function sameHex(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}
function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" &&
    isAddress(a) && isAddress(b) && getAddress(a) === getAddress(b);
}

/** Sign a bounded type-2 transaction; this function never broadcasts. */
export async function signChilizTransaction({ publicClient, account, to, data, value = 0n, kind }) {
  if (kind !== "purchase" && kind !== "claim") throw new Error("chiliz_intent_kind_invalid");
  if (await publicClient.getChainId() !== CHILIZ_CHAIN_ID) throw new Error("chiliz_chain_mismatch");
  const [nonce, estimate, fees] = await Promise.all([
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    publicClient.estimateGas({ account: account.address, to, data, value }),
    publicClient.estimateFeesPerGas({ type: "eip1559" }),
  ]);
  if (!Number.isSafeInteger(nonce) || nonce < 0 || typeof estimate !== "bigint" || estimate <= 0n) {
    throw new Error("chiliz_nonce_or_gas_invalid");
  }
  const gas = (estimate * 12n + 9n) / 10n;
  const maxFeePerGas = fees.maxFeePerGas;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  if (gas > MAX_GAS_LIMIT || typeof maxFeePerGas !== "bigint" || maxFeePerGas <= 0n ||
    typeof maxPriorityFeePerGas !== "bigint" || maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error("chiliz_gas_quote_invalid");
  }
  const gasFeeCeilingWei = gas * maxFeePerGas;
  if (gasFeeCeilingWei > (kind === "purchase" ? MAX_PURCHASE_FEE_WEI : MAX_CLAIM_FEE_WEI)) {
    throw new Error("chiliz_gas_fee_cap_exceeded");
  }
  const rawTransaction = await account.signTransaction({ chainId: CHILIZ_CHAIN_ID,
    type: "eip1559", nonce, gas, maxFeePerGas, maxPriorityFeePerGas,
    to, data, value });
  return { rawTransaction, gasFeeCeilingWei };
}

/** The API must durably commit these exact bytes before even one network send. */
export async function persistChilizIntent(request, api) {
  const intent = await createChilizSignedIntent(request);
  const response = await api({ action: "prepare_chiliz_intent", ...request });
  if (response?.prepared !== true || !sameHex(response.txHash, intent.txHash) ||
    !sameHex(response.rawTransaction, intent.rawTransaction)) {
    throw new Error("chiliz_persisted_intent_mismatch");
  }
  return intent;
}

/** A send error is ambiguous: callers must look up the SAME hash, never sign a replacement. */
export async function sendPersistedChilizIntent(intent, publicClient, now = Date.now) {
  const verified = await verifyPersistedChilizSignedIntent(intent);
  if (verified.kind === "purchase" && Math.floor(now() / 1_000) >= verified.deadlineEpochSeconds) {
    throw new Error("chiliz_purchase_intent_expired");
  }
  try {
    const returnedHash = await publicClient.sendRawTransaction({
      serializedTransaction: verified.rawTransaction,
    });
    if (!sameHex(returnedHash, verified.txHash)) {
      return { acknowledged: false, txHash: verified.txHash };
    }
    return { acknowledged: true, txHash: verified.txHash };
  } catch {
    // The RPC may have accepted the transaction before a response was lost.
    return { acknowledged: false, txHash: verified.txHash };
  }
}

function finalizedHeight(block) {
  if (!block || !/^0x[0-9a-fA-F]+$/.test(block.number) ||
    !/^0x[0-9a-fA-F]{64}$/.test(block.hash) || BigInt(block.number) <= 0n) {
    throw new Error("chiliz_finalized_rpc_unavailable");
  }
  return BigInt(block.number);
}

/** Require the BSC-style -3 validator proof and independent canonical RPC agreement. */
export async function waitForFinalizedChilizReceipt(intent, publicClient, secondaryClient,
  { timeoutMs = 120_000, pollMs = 5_000, now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const verified = await verifyPersistedChilizSignedIntent(intent);
  const deadline = now() + timeoutMs;
  do {
    let receipt = null;
    try { receipt = await publicClient.getTransactionReceipt({ hash: verified.txHash }); }
    catch { /* Missing or temporarily unavailable receipts are unresolved. */ }
    if (receipt) {
      let evidence;
      try {
        evidence = await Promise.all([
          publicClient.getChainId(),
          publicClient.getTransaction({ hash: verified.txHash }),
          publicClient.getBlock({ blockNumber: receipt.blockNumber }),
          publicClient.request({ method: "eth_getFinalizedBlock", params: [-3, false] }),
          secondaryClient.getChainId(),
          secondaryClient.getTransactionReceipt({ hash: verified.txHash }),
          secondaryClient.getBlock({ blockNumber: receipt.blockNumber }),
          secondaryClient.request({ method: "eth_getFinalizedBlock", params: [-3, false] }),
        ]);
      } catch {
        // A lagging or unavailable RPC cannot prove delivery; retry reads only.
        if (now() >= deadline) break;
        await sleep(pollMs);
        continue;
      }
      const [chainId, transaction, canonicalBlock, finalizedBlock,
        secondaryChainId, secondaryReceipt, secondaryCanonicalBlock, secondaryFinalizedBlock] = evidence;
      const primaryFinalizedHeight = finalizedHeight(finalizedBlock);
      const secondaryFinalizedHeight = finalizedHeight(secondaryFinalizedBlock);
      const [primaryFinalizedCanonical, secondaryFinalizedCanonical] = await Promise.all([
        publicClient.getBlock({ blockNumber: primaryFinalizedHeight }),
        secondaryClient.getBlock({ blockNumber: secondaryFinalizedHeight }),
      ]);
      if (secondaryChainId !== CHILIZ_CHAIN_ID || !canonicalBlock.hash ||
        !sameHex(primaryFinalizedCanonical.hash, finalizedBlock.hash) ||
        !sameHex(secondaryFinalizedCanonical.hash, secondaryFinalizedBlock.hash) ||
        !sameHex(canonicalBlock.hash, receipt.blockHash) ||
        !sameHex(secondaryCanonicalBlock.hash, receipt.blockHash) ||
        !sameHex(secondaryReceipt.transactionHash, verified.txHash) ||
        !sameHex(secondaryReceipt.blockHash, receipt.blockHash) ||
        secondaryReceipt.blockNumber !== receipt.blockNumber ||
        secondaryReceipt.status !== receipt.status) {
        throw new Error("chiliz_secondary_receipt_mismatch");
      }
      const result = await reconcileChilizSignedIntent(verified, {
        chainId, transaction, receipt,
        canonicalReceiptBlockHash: canonicalBlock.hash,
        finalizedBlockNumber: primaryFinalizedHeight < secondaryFinalizedHeight
          ? primaryFinalizedHeight : secondaryFinalizedHeight,
      });
      if (result.state === "finalized_success") return receipt;
      if (result.state === "finalized_reverted") throw new Error("chiliz_transaction_finalized_reverted");
    }
    if (now() >= deadline) break;
    await sleep(pollMs);
  } while (now() <= deadline);
  throw new Error("chiliz_transaction_finality_unresolved");
}

/** Derive the claimed fan-token output from the finalized receipt, not a balance race. */
export function purchasedTokenOutput(intent, receipt) {
  if (intent.kind !== "purchase" || !Array.isArray(receipt?.logs)) {
    throw new Error("chiliz_purchase_receipt_invalid");
  }
  let incoming = 0n;
  let outgoing = 0n;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, intent.fanTokenContract)) continue;
    let decoded;
    try { decoded = decodeEventLog({ abi: ERC20, eventName: "Transfer",
      data: log.data, topics: log.topics, strict: true }); }
    catch { continue; }
    if (decoded.eventName !== "Transfer") continue;
    if (sameAddress(decoded.args.to, intent.treasury)) incoming += decoded.args.value;
    if (sameAddress(decoded.args.from, intent.treasury)) outgoing += decoded.args.value;
  }
  const net = incoming - outgoing;
  if (net <= 0n || net < BigInt(intent.minimumOutputAtomic)) {
    throw new Error("chiliz_purchase_output_unverified");
  }
  return net.toString();
}

/** A recovered intent is read from durable storage; never synthesize replacement bytes. */
export async function verifyRecoveredChilizIntent(prepared, treasury) {
  if (!prepared || typeof prepared.jobId !== "string" || !prepared.intent) {
    throw new Error("chiliz_recovered_intent_invalid");
  }
  const intent = await verifyPersistedChilizSignedIntent(prepared.intent);
  if (prepared.jobId !== intent.jobId || !sameAddress(intent.treasury, treasury) ||
    !sameHex(keccak256(intent.rawTransaction), intent.txHash)) {
    throw new Error("chiliz_recovered_intent_mismatch");
  }
  return intent;
}
