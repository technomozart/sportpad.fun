import bs58 from "bs58";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { feeEventId, splitCreatorFee } from "./accounting.ts";
import { REPLENISHMENT_ASSETS, validatePublicWallets } from "./replenishment.ts";

/** One exact, single-source funding leg. These are independently verified
 * chain/ledger observations supplied by a trusted caller, not raw provider
 * responses. This module checks their arithmetic and identity only; it does
 * not query either chain, reserve funds, or authorize a transaction. */
export type ChilizFundingProvenance = {
  expected: {
    launchId: string;
    solanaRewardTreasury: string;
    chilizTreasury: string;
  };
  settlements: readonly {
    id: string;
    feeEventId: string;
    launchId: string;
    feeSourceSignature: string;
    feeInstructionIndex: number;
    feeSourceSlot: number;
    feeFinalizedSlot: number;
    feeState: "reconciled";
    settlementState: "reconciled";
    grossAmountLamports: string;
    rewardAmountLamports: string;
    buybackAmountLamports: string;
  }[];
  swap: {
    signature: string;
    sourceWallet: string;
    inputMint: string;
    outputMint: string;
    inputAmountLamports: string;
    outputAmountAtomic: string;
    outputAccount: string;
    outputBalanceBeforeAtomic: string;
    outputBalanceAfterAtomic: string;
    finalizedSlot: number;
    finalized: boolean;
    status: "success";
  };
  bridge: {
    quoteId: string;
    sourceSignature: string;
    sourceWallet: string;
    sourceMint: string;
    sourceAccount: string;
    sourceAmountAtomic: string;
    sourceBalanceBeforeAtomic: string;
    sourceBalanceAfterAtomic: string;
    sourceFinalizedSlot: number;
    sourceFinalized: boolean;
    sourceStatus: "success";
    messageId: string;
    destinationTxHash: string;
    destinationChainId: number;
    destinationTreasury: string;
    destinationAsset: string;
    destinationReceivedWei: string;
    destinationBalanceBeforeWei: string;
    destinationBalanceAfterWei: string;
    minimumDestinationWei: string;
    destinationFinalizedBlock: number;
    destinationObservedBlock: number;
    destinationFinalized: boolean;
    destinationStatus: "success";
  };
  /** An authoritative, transactionally obtained consumed-reference snapshot is
   * required. The returned keys still need durable UNIQUE constraints and an
   * atomic reservation before any eventual purchase. */
  consumedReferences: {
    settlementIds: readonly string[];
    feeEventIds: readonly string[];
    swapSignatures: readonly string[];
    bridgeSourceSignatures: readonly string[];
    bridgeMessageIds: readonly string[];
    destinationTxHashes: readonly string[];
  };
};

const MAX_SWAP_LAMPORTS = 100_000_000n;
const MAX_BRIDGE_CHZ_ATOMIC = 10n * 10n ** 8n;
const CHZ_DECIMAL_SHIFT = 10n ** BigInt(
  REPLENISHMENT_ASSETS.nativeChilizChzDecimals - REPLENISHMENT_ASSETS.solanaChzDecimals);

function fail(code: string): never {
  throw new Error(`chiliz_funding_${code}`);
}

function atomic(value: unknown, label: string, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail(`${label}_invalid`);
  const amount = BigInt(value);
  if (!allowZero && amount === 0n) fail(`${label}_zero`);
  return amount;
}

function slot(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${label}_invalid`);
  return Number(value);
}

function solanaSignature(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label}_invalid`);
  try {
    if (bs58.decode(value).length !== 64) fail(`${label}_invalid`);
  } catch { fail(`${label}_invalid`); }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value ||
      value.length < 4 || value.length > 256) fail(`${label}_invalid`);
  return value;
}

function sameEvm(first: string, second: string): boolean {
  return typeof first === "string" && /^0x[0-9a-fA-F]{40}$/.test(first) &&
    first.toLowerCase() === second.toLowerCase();
}

function uniqueNotConsumed(value: string, used: readonly string[], label: string): void {
  if (!Array.isArray(used) || used.some((entry) => typeof entry !== "string")) fail(`${label}_ledger_invalid`);
  if (used.includes(value)) fail(`${label}_reused`);
}

/** Checks an exact 80% community fee funding chain. A passing result is a
 * candidate for an atomic durable reservation, never permission to execute.
 * The caller must verify all source/destination receipts, finality and account
 * balances independently before supplying them here. */
export function validateChilizFundingProvenance(input: ChilizFundingProvenance) {
  if (!input || typeof input !== "object") fail("input_invalid");
  const { expected, settlements, swap, bridge, consumedReferences } = input;
  if (!expected || !swap || !bridge || !consumedReferences ||
      !Array.isArray(settlements) || settlements.length === 0) fail("proof_incomplete");
  const launchId = identifier(expected.launchId, "launch_id");
  const wallets = validatePublicWallets(expected.solanaRewardTreasury, expected.chilizTreasury);
  const settlementIds = new Set<string>();
  const feeEventIds = new Set<string>();
  let rewardTotal = 0n;
  let latestFeeFinalizedSlot = 0;
  for (const settlement of settlements) {
    if (!settlement || settlement.launchId !== launchId ||
        settlement.feeState !== "reconciled" || settlement.settlementState !== "reconciled") {
      fail("settlement_not_reconciled");
    }
    const signature = solanaSignature(settlement.feeSourceSignature, "fee_signature");
    if (!Number.isSafeInteger(settlement.feeInstructionIndex) || settlement.feeInstructionIndex < 0) {
      fail("fee_instruction_invalid");
    }
    const eventId = feeEventId(signature, settlement.feeInstructionIndex);
    if (settlement.feeEventId !== eventId || settlement.id !== `settlement:${eventId}`) {
      fail("fee_identity_mismatch");
    }
    if (feeEventIds.has(eventId) || settlementIds.has(settlement.id)) fail("duplicate_settlement");
    feeEventIds.add(eventId);
    settlementIds.add(settlement.id);
    uniqueNotConsumed(eventId, consumedReferences.feeEventIds, "fee_event");
    uniqueNotConsumed(settlement.id, consumedReferences.settlementIds, "settlement");
    const observedSlot = slot(settlement.feeSourceSlot, "fee_source_slot");
    const finalizedSlot = slot(settlement.feeFinalizedSlot, "fee_finalized_slot");
    if (finalizedSlot < observedSlot) fail("fee_not_finalized");
    latestFeeFinalizedSlot = Math.max(latestFeeFinalizedSlot, finalizedSlot);
    const gross = atomic(settlement.grossAmountLamports, "gross_fee");
    const share = splitCreatorFee(gross);
    if (share.rewardAtomic === 0n ||
        share.rewardAtomic !== atomic(settlement.rewardAmountLamports, "reward_share") ||
        share.buybackAtomic !== atomic(settlement.buybackAmountLamports, "buyback_share")) {
      fail("fee_split_mismatch");
    }
    rewardTotal += share.rewardAtomic;
  }
  if (rewardTotal > MAX_SWAP_LAMPORTS) fail("sol_swap_cap_exceeded");

  const swapSignature = solanaSignature(swap.signature, "swap_signature");
  uniqueNotConsumed(swapSignature, consumedReferences.swapSignatures, "swap_signature");
  uniqueNotConsumed(swapSignature, consumedReferences.bridgeSourceSignatures, "swap_signature");
  if (swap.sourceWallet !== wallets.solanaWallet ||
      swap.inputMint !== REPLENISHMENT_ASSETS.solMint ||
      swap.outputMint !== REPLENISHMENT_ASSETS.solanaChzMint ||
      swap.finalized !== true || swap.status !== "success") fail("swap_receipt_mismatch");
  const swapSlot = slot(swap.finalizedSlot, "swap_finalized_slot");
  // A shared finalized slot does not prove the fee distribution preceded the
  // swap; hold it unless an independent transaction-order proof is added.
  if (swapSlot <= latestFeeFinalizedSlot ||
      atomic(swap.inputAmountLamports, "swap_input") !== rewardTotal) fail("swap_source_mismatch");
  const swapOutput = atomic(swap.outputAmountAtomic, "swap_output");
  const swapBefore = atomic(swap.outputBalanceBeforeAtomic, "swap_balance_before", true);
  const swapAfter = atomic(swap.outputBalanceAfterAtomic, "swap_balance_after");
  if (swapAfter - swapBefore !== swapOutput || swapOutput > MAX_BRIDGE_CHZ_ATOMIC) {
    fail("swap_output_balance_mismatch");
  }
  const vault = new PublicKey(wallets.solanaWallet);
  const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
  const expectedOutputAccounts = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) =>
    getAssociatedTokenAddressSync(mint, vault, false, program).toBase58());
  if (!expectedOutputAccounts.includes(swap.outputAccount)) fail("swap_output_account_mismatch");

  const bridgeSignature = solanaSignature(bridge.sourceSignature, "bridge_signature");
  uniqueNotConsumed(bridgeSignature, consumedReferences.bridgeSourceSignatures, "bridge_signature");
  uniqueNotConsumed(bridgeSignature, consumedReferences.swapSignatures, "bridge_signature");
  identifier(bridge.messageId, "bridge_message_id");
  uniqueNotConsumed(bridge.messageId, consumedReferences.bridgeMessageIds, "bridge_message_id");
  if (typeof bridge.destinationTxHash !== "string") fail("destination_hash_invalid");
  const destinationTxHash = bridge.destinationTxHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(destinationTxHash)) fail("destination_hash_invalid");
  if (!Array.isArray(consumedReferences.destinationTxHashes) ||
      consumedReferences.destinationTxHashes.some((entry) => typeof entry !== "string")) {
    fail("destination_hash_ledger_invalid");
  }
  if (consumedReferences.destinationTxHashes.some((entry) => entry.toLowerCase() === destinationTxHash)) {
    fail("destination_hash_reused");
  }
  if (bridgeSignature === swapSignature ||
      bridge.sourceWallet !== wallets.solanaWallet ||
      bridge.sourceMint !== REPLENISHMENT_ASSETS.solanaChzMint ||
      bridge.sourceAccount !== swap.outputAccount ||
      bridge.sourceFinalized !== true || bridge.sourceStatus !== "success" ||
      bridge.destinationFinalized !== true || bridge.destinationStatus !== "success" ||
      bridge.destinationChainId !== REPLENISHMENT_ASSETS.chilizChainId ||
      !sameEvm(bridge.destinationTreasury, wallets.chilizWallet) ||
      !sameEvm(bridge.destinationAsset, REPLENISHMENT_ASSETS.nativeChilizChz)) {
    fail("bridge_receipt_mismatch");
  }
  identifier(bridge.quoteId, "bridge_quote_id");
  const bridgeSlot = slot(bridge.sourceFinalizedSlot, "bridge_source_slot");
  const destinationBlock = slot(bridge.destinationFinalizedBlock, "destination_finalized_block");
  const observedBlock = slot(bridge.destinationObservedBlock, "destination_observed_block");
  if (bridgeSlot <= swapSlot || observedBlock <= destinationBlock ||
      atomic(bridge.sourceAmountAtomic, "bridge_source") !== swapOutput ||
      atomic(bridge.sourceBalanceBeforeAtomic, "bridge_balance_before") !== swapAfter ||
      atomic(bridge.sourceBalanceAfterAtomic, "bridge_balance_after", true) !== swapBefore) {
    fail("bridge_source_balance_mismatch");
  }
  const received = atomic(bridge.destinationReceivedWei, "destination_received");
  const minimum = atomic(bridge.minimumDestinationWei, "destination_minimum");
  const destinationBefore = atomic(bridge.destinationBalanceBeforeWei, "destination_balance_before", true);
  const destinationAfter = atomic(bridge.destinationBalanceAfterWei, "destination_balance_after");
  const parity = swapOutput * CHZ_DECIMAL_SHIFT;
  if (received < minimum || minimum * 100n < parity * 95n ||
      received > parity * 105n / 100n || destinationAfter - destinationBefore !== received) {
    fail("destination_credit_mismatch");
  }

  return {
    provenanceConsistent: true as const,
    purchaseExecutionReady: false as const,
    launchId,
    settlementIds: [...settlementIds],
    feeEventIds: [...feeEventIds],
    rewardInputLamports: rewardTotal.toString(),
    nativeChzReceivedWei: received.toString(),
    consumptionKeys: {
      swapSignature,
      bridgeSourceSignature: bridgeSignature,
      bridgeMessageId: bridge.messageId,
      destinationTxHash,
    },
  };
}
