import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { validateChilizFundingProvenance, type ChilizFundingProvenance } from
  "./chiliz-funding-provenance.ts";
import { REPLENISHMENT_ASSETS } from "./replenishment.ts";

const signature = (byte: number) => bs58.encode(new Uint8Array(64).fill(byte));
const source = "yCBTQi7aUfQ7ytdmdMRC1BLjntduQYniZVELRc1mvF4";
const treasury = "0x42c40359Da463b480C3Dc9e7A4D9c1ac2eF45C21";
const outputAccount = getAssociatedTokenAddressSync(
  new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint), new PublicKey(source),
  false, TOKEN_PROGRAM_ID).toBase58();

function proof(): ChilizFundingProvenance {
  const feeSignature = signature(1);
  const feeEventId = `${feeSignature}:0`;
  return {
    expected: { launchId: "launch-1", solanaRewardTreasury: source, chilizTreasury: treasury },
    settlements: [{
      id: `settlement:${feeEventId}`, feeEventId, launchId: "launch-1",
      feeSourceSignature: feeSignature, feeInstructionIndex: 0,
      feeSourceSlot: 10, feeFinalizedSlot: 11, feeState: "reconciled",
      settlementState: "reconciled", grossAmountLamports: "1250000",
      rewardAmountLamports: "1000000", buybackAmountLamports: "250000",
    }],
    swap: {
      signature: signature(2), sourceWallet: source,
      inputMint: REPLENISHMENT_ASSETS.solMint,
      outputMint: REPLENISHMENT_ASSETS.solanaChzMint,
      inputAmountLamports: "1000000", outputAmountAtomic: "500000000",
      outputAccount, outputBalanceBeforeAtomic: "0",
      outputBalanceAfterAtomic: "500000000", finalizedSlot: 13,
      finalized: true, status: "success",
    },
    bridge: {
      quoteId: "quote-1", sourceSignature: signature(3), sourceWallet: source,
      sourceMint: REPLENISHMENT_ASSETS.solanaChzMint, sourceAccount: outputAccount,
      sourceAmountAtomic: "500000000", sourceBalanceBeforeAtomic: "500000000",
      sourceBalanceAfterAtomic: "0", sourceFinalizedSlot: 15,
      sourceFinalized: true, sourceStatus: "success", messageId: "message-1",
      destinationTxHash: `0x${"a".repeat(64)}`, destinationChainId: 88888,
      destinationTreasury: treasury,
      destinationAsset: REPLENISHMENT_ASSETS.nativeChilizChz,
      destinationReceivedWei: "4900000000000000000",
      destinationBalanceBeforeWei: "1000000000000000000",
      destinationBalanceAfterWei: "5900000000000000000",
      minimumDestinationWei: "4800000000000000000",
      destinationFinalizedBlock: 100, destinationObservedBlock: 102,
      destinationFinalized: true, destinationStatus: "success",
    },
    consumedReferences: {
      settlementIds: [], feeEventIds: [], swapSignatures: [],
      bridgeSourceSignatures: [], bridgeMessageIds: [], destinationTxHashes: [],
    },
  };
}

test("exact reconciled 80% SOL fees trace through finalized CHZ swap and bridge credit", () => {
  const result = validateChilizFundingProvenance(proof());
  assert.equal(result.provenanceConsistent, true);
  assert.equal(result.purchaseExecutionReady, false);
  assert.equal(result.rewardInputLamports, "1000000");
  assert.equal(result.nativeChzReceivedWei, "4900000000000000000");
  assert.equal(result.settlementIds.length, 1);
  assert.equal(result.consumptionKeys.destinationTxHash, `0x${"a".repeat(64)}`);
});

test("a wrong fee share, source, order, or duplicate settlement cannot fund Chiliz", () => {
  const badSplit = proof();
  badSplit.settlements = [{ ...badSplit.settlements[0], rewardAmountLamports: "900000" }];
  assert.throws(() => validateChilizFundingProvenance(badSplit), /fee_split_mismatch/);
  const wrongLaunch = proof();
  wrongLaunch.settlements = [{ ...wrongLaunch.settlements[0], launchId: "other" }];
  assert.throws(() => validateChilizFundingProvenance(wrongLaunch), /settlement_not_reconciled/);
  const wrongInput = proof();
  wrongInput.swap.inputAmountLamports = "999999";
  assert.throws(() => validateChilizFundingProvenance(wrongInput), /swap_source_mismatch/);
  const sameSlot = proof();
  sameSlot.swap.finalizedSlot = sameSlot.settlements[0].feeFinalizedSlot;
  assert.throws(() => validateChilizFundingProvenance(sameSlot), /swap_source_mismatch/);
  const wrongOrder = proof();
  wrongOrder.bridge.sourceFinalizedSlot = wrongOrder.swap.finalizedSlot;
  assert.throws(() => validateChilizFundingProvenance(wrongOrder), /bridge_source_balance_mismatch/);
  const duplicate = proof();
  duplicate.settlements = [duplicate.settlements[0], duplicate.settlements[0]];
  assert.throws(() => validateChilizFundingProvenance(duplicate), /duplicate_settlement/);
});

test("unfinalized or mismatched swap/bridge balances and wrong chain are held", () => {
  const unfinalized = proof();
  unfinalized.swap.finalized = false;
  assert.throws(() => validateChilizFundingProvenance(unfinalized), /swap_receipt_mismatch/);
  const output = proof();
  output.swap.outputBalanceAfterAtomic = "499999999";
  assert.throws(() => validateChilizFundingProvenance(output), /swap_output_balance_mismatch/);
  const wrongAccount = proof();
  wrongAccount.swap.outputAccount = source;
  wrongAccount.bridge.sourceAccount = source;
  assert.throws(() => validateChilizFundingProvenance(wrongAccount), /swap_output_account_mismatch/);
  const sourceDebit = proof();
  sourceDebit.bridge.sourceBalanceAfterAtomic = "1";
  assert.throws(() => validateChilizFundingProvenance(sourceDebit), /bridge_source_balance_mismatch/);
  const wrongChain = proof();
  wrongChain.bridge.destinationChainId = 1;
  assert.throws(() => validateChilizFundingProvenance(wrongChain), /bridge_receipt_mismatch/);
  const unfinalizedDestination = proof();
  unfinalizedDestination.bridge.destinationFinalized = false;
  assert.throws(() => validateChilizFundingProvenance(unfinalizedDestination), /bridge_receipt_mismatch/);
  const balanceCredit = proof();
  balanceCredit.bridge.destinationBalanceAfterWei = "6000000000000000000";
  assert.throws(() => validateChilizFundingProvenance(balanceCredit), /destination_credit_mismatch/);
  const shallow = proof();
  shallow.bridge.destinationObservedBlock = shallow.bridge.destinationFinalizedBlock;
  assert.throws(() => validateChilizFundingProvenance(shallow), /bridge_source_balance_mismatch/);
});

test("each source and destination reference must be unused", () => {
  const original = proof();
  for (const [field, value, message] of [
    ["settlementIds", original.settlements[0].id, /settlement_reused/],
    ["feeEventIds", original.settlements[0].feeEventId, /fee_event_reused/],
    ["swapSignatures", original.swap.signature, /swap_signature_reused/],
    ["bridgeSourceSignatures", original.bridge.sourceSignature, /bridge_signature_reused/],
    ["bridgeMessageIds", original.bridge.messageId, /bridge_message_id_reused/],
    ["destinationTxHashes", original.bridge.destinationTxHash.toUpperCase(), /destination_hash_reused/],
  ] as const) {
    const input = proof();
    input.consumedReferences[field] = [value];
    assert.throws(() => validateChilizFundingProvenance(input), message);
  }
  const crossRole = proof();
  crossRole.consumedReferences.swapSignatures = [crossRole.bridge.sourceSignature];
  assert.throws(() => validateChilizFundingProvenance(crossRole), /bridge_signature_reused/);
});
