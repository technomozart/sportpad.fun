import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";

import { CHILIZ_ASSET_MIGRATION_VERIFIED, CHILIZ_CHAIN_ID, KAYEN_ROUTER, WRAPPED_CHZ,
  verifyChilizPurchaseReceipt, verifyChilizTransferReceipt, type ChilizChainEvidence } from "./chiliz-receipts.ts";

const treasury = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const otherToken = "0x3333333333333333333333333333333333333333";
const fanToken = "0x4444444444444444444444444444444444444444";
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const zero = "0x0000000000000000000000000000000000000000";

const routerAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const tokenAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

function transfer(token: string, from: string, to: string, amount: bigint) {
  return { address: token, topics: [transferTopic, `0x${"0".repeat(24)}${from.slice(2)}`,
    `0x${"0".repeat(24)}${to.slice(2)}`], data: `0x${amount.toString(16).padStart(64, "0")}` };
}

function evidence(input: string, to: string, value: bigint, logs: ReturnType<typeof transfer>[]): ChilizChainEvidence {
  return {
    chainId: CHILIZ_CHAIN_ID, latestBlock: 102n, tokenDecimals: 18,
    transaction: { hash, from: treasury, to, input, value, chainId: CHILIZ_CHAIN_ID,
      blockHash, blockNumber: 100n },
    receipt: { transactionHash: hash, status: "success", blockHash, blockNumber: 100n, logs },
  };
}

const purchaseInput = encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
  args: [99n, [WRAPPED_CHZ, fanToken], treasury, 1_800_000_000n] });
const purchaseExpected = { txHash: hash, treasury, fanTokenContract: fanToken,
  outputAmountAtomic: "100", maxSpendChzWei: "10" };

test("a purchase credits only official V2 tokens actually transferred to the configured treasury", () => {
  const proof = evidence(purchaseInput, KAYEN_ROUTER, 10n, [transfer(fanToken, zero, treasury, 100n)]);
  assert.deepEqual(verifyChilizPurchaseReceipt(proof, purchaseExpected), { acquiredAtomic: 100n, spentChzWei: 10n });
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, chainId: 1 }, purchaseExpected), /chiliz_chain_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, tokenDecimals: 0 }, purchaseExpected), /chiliz_v2_decimals_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, latestBlock: 100n }, purchaseExpected), /chiliz_transaction_not_confirmed/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, transaction: { ...proof.transaction, from: recipient } }, purchaseExpected), /chiliz_treasury_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, transaction: { ...proof.transaction, to: recipient } }, purchaseExpected), /chiliz_purchase_target_or_value_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, receipt: { ...proof.receipt,
    transactionHash: `0x${"c".repeat(64)}` } }, purchaseExpected), /chiliz_hash_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, receipt: { ...proof.receipt, logs: [transfer(otherToken, zero, treasury, 100n)] } }, purchaseExpected), /chiliz_purchase_output_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, receipt: { ...proof.receipt,
    logs: [transfer(fanToken, zero, treasury, 100n), transfer(fanToken, treasury, recipient, 1n)] } }, purchaseExpected), /chiliz_purchase_output_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt({ ...proof, receipt: { ...proof.receipt,
    logs: [{ ...transfer(fanToken, zero, treasury, 100n), data: "0x01" }] } }, purchaseExpected), /chiliz_transfer_log_invalid/);
  assert.throws(() => verifyChilizPurchaseReceipt(proof, { ...purchaseExpected, outputAmountAtomic: "101" }), /chiliz_purchase_output_mismatch/);
  assert.throws(() => verifyChilizPurchaseReceipt(proof, { ...purchaseExpected, maxSpendChzWei: "9" }), /chiliz_purchase_spend_cap_exceeded/);
});

test("purchase calldata must name the current V2 asset and treasury", () => {
  const wrongAsset = encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
    args: [99n, [WRAPPED_CHZ, otherToken], treasury, 1_800_000_000n] });
  const wrongRecipient = encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
    args: [99n, [WRAPPED_CHZ, fanToken], recipient, 1_800_000_000n] });
  const logs = [transfer(fanToken, zero, treasury, 100n)];
  assert.throws(() => verifyChilizPurchaseReceipt(evidence(wrongAsset, KAYEN_ROUTER, 10n, logs), purchaseExpected), /chiliz_purchase_calldata_invalid/);
  assert.throws(() => verifyChilizPurchaseReceipt(evidence(wrongRecipient, KAYEN_ROUTER, 10n, logs), purchaseExpected), /chiliz_purchase_calldata_invalid/);
  assert.throws(() => verifyChilizPurchaseReceipt(evidence(`${purchaseInput}ffff`, KAYEN_ROUTER, 10n, logs), purchaseExpected), /chiliz_purchase_calldata_invalid/);
});

const claimInput = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [recipient, 100n] });
const claimExpected = { txHash: hash, treasury, destination: recipient, fanTokenContract: fanToken, amountAtomic: "100" };

test("Chiliz execution remains held until V2 acquisition and payout are verified", () => {
  assert.equal(CHILIZ_ASSET_MIGRATION_VERIFIED, false);
});

test("a transfer completes only after the exact current V2 Fan Token reaches the linked recipient", () => {
  const proof = evidence(claimInput, fanToken, 0n, [transfer(fanToken, treasury, recipient, 100n)]);
  assert.deepEqual(verifyChilizTransferReceipt(proof, claimExpected), { deliveredAtomic: 100n });
  assert.throws(() => verifyChilizTransferReceipt({ ...proof, receipt: { ...proof.receipt, status: "reverted" } }, claimExpected), /chiliz_transaction_not_confirmed/);
  assert.throws(() => verifyChilizTransferReceipt({ ...proof, transaction: { ...proof.transaction, to: KAYEN_ROUTER } }, claimExpected), /chiliz_transfer_target_or_value_mismatch/);
  assert.throws(() => verifyChilizTransferReceipt({ ...proof, receipt: { ...proof.receipt, logs: [transfer(fanToken, treasury, recipient, 99n)] } }, claimExpected), /chiliz_transfer_delivery_mismatch/);
  assert.throws(() => verifyChilizTransferReceipt({ ...proof, receipt: { ...proof.receipt, logs: [transfer(otherToken, treasury, recipient, 100n)] } }, claimExpected), /chiliz_transfer_delivery_mismatch/);
});

test("a transfer to another address, token, or amount never releases a claim", () => {
  const logs = [transfer(fanToken, treasury, recipient, 100n)];
  for (const input of [
    encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [treasury, 100n] }),
    encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [recipient, 99n] }),
    `${claimInput}ffff`,
  ]) {
    assert.throws(() => verifyChilizTransferReceipt(evidence(input, fanToken, 0n, logs), claimExpected), /chiliz_transfer_calldata_invalid/);
  }
  assert.throws(() => verifyChilizTransferReceipt(evidence(claimInput, otherToken, 0n, logs), claimExpected), /chiliz_transfer_target_or_value_mismatch/);
});
