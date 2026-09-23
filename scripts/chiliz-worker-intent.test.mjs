import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseTransaction } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createChilizSignedIntent } from "../lib/protocol/chiliz-signed-intent.ts";
import { CHILIZ_CHAIN_ID, KAYEN_ROUTER, WRAPPED_CHZ } from "../lib/protocol/chiliz-receipts.ts";
import { persistChilizIntent, purchasedTokenOutput, sendPersistedChilizIntent,
  signChilizTransaction, verifyRecoveredChilizIntent, waitForFinalizedChilizReceipt,
} from "./chiliz-worker-intent.mjs";

const account = privateKeyToAccount(generatePrivateKey());
const token = getAddress("0x4444444444444444444444444444444444444444");
const blockHash = `0x${"a".repeat(64)}`;
const routerAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function purchaseIntent() {
  const signedAtEpochSeconds = 1_800_000_000;
  const deadlineEpochSeconds = signedAtEpochSeconds + 120;
  const rawTransaction = await account.signTransaction({
    type: "eip1559", chainId: CHILIZ_CHAIN_ID, nonce: 7, gas: 200_000n,
    maxFeePerGas: 2_500_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
    to: KAYEN_ROUTER, value: 2n * 10n ** 18n,
    data: encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
      args: [100n, [WRAPPED_CHZ, token], account.address, BigInt(deadlineEpochSeconds)] }),
  });
  return createChilizSignedIntent({ kind: "purchase", jobId: "job_1", attempt: 1,
    treasury: account.address, fanTokenContract: token, rawTransaction,
    gasFeeCeilingWei: (10n ** 18n).toString(), maxPrincipalWei: (2n * 10n ** 18n).toString(),
    minimumOutputAtomic: "100", signedAtEpochSeconds, deadlineEpochSeconds });
}

test("bounded type-2 signing never broadcasts and rejects an excessive gas ceiling", async () => {
  let signed = 0;
  const mockedAccount = { address: account.address, signTransaction: async (request) => {
    signed += 1;
    return account.signTransaction(request);
  } };
  const mockClient = { getChainId: async () => CHILIZ_CHAIN_ID,
    getTransactionCount: async () => 7,
    estimateGas: async () => 100_000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n }),
  };
  const result = await signChilizTransaction({ publicClient: mockClient, account: mockedAccount,
    to: token, data: "0x12345678", value: 0n, kind: "claim" });
  assert.equal(parseTransaction(result.rawTransaction).type, "eip1559");
  assert.equal(signed, 1);
  await assert.rejects(signChilizTransaction({ publicClient: {
    ...mockClient, estimateFeesPerGas: async () => ({ maxFeePerGas: 10n ** 15n,
      maxPriorityFeePerGas: 1n }),
  }, account: mockedAccount, to: token, data: "0x12345678", kind: "claim" }),
  /chiliz_gas_fee_cap_exceeded/);
  assert.equal(signed, 1);
});

test("intent must be durably echoed before any raw submission", async () => {
  const intent = await purchaseIntent();
  let prepared = false;
  const persisted = await persistChilizIntent(intent, async (body) => {
    assert.equal(body.action, "prepare_chiliz_intent");
    prepared = true;
    return { prepared: true, txHash: intent.txHash, rawTransaction: intent.rawTransaction };
  });
  const submissions = [];
  const submitted = await sendPersistedChilizIntent(persisted, {
    sendRawTransaction: async ({ serializedTransaction }) => {
      assert.equal(prepared, true);
      submissions.push(serializedTransaction);
      return intent.txHash;
    },
  }, () => 1_800_000_010_000);
  assert.equal(submitted.acknowledged, true);
  assert.deepEqual(submissions, [intent.rawTransaction]);
  await assert.rejects(persistChilizIntent(intent, async () => ({ prepared: true,
    txHash: `0x${"b".repeat(64)}`, rawTransaction: intent.rawTransaction })),
  /chiliz_persisted_intent_mismatch/);
});

test("expired purchase raw cannot be broadcast again", async () => {
  const intent = await purchaseIntent();
  let sent = false;
  await assert.rejects(sendPersistedChilizIntent(intent, {
    sendRawTransaction: async () => { sent = true; return intent.txHash; },
  }, () => (intent.deadlineEpochSeconds + 1) * 1_000), /chiliz_purchase_intent_expired/);
  assert.equal(sent, false);
});

test("same-raw recovery verifies stored signature and finalized canonical receipt", async () => {
  const intent = await purchaseIntent();
  assert.equal(keccak256(intent.rawTransaction), intent.txHash);
  const recovered = await verifyRecoveredChilizIntent({ jobId: intent.jobId, intent }, account.address);
  assert.equal(recovered.rawTransaction, intent.rawTransaction);
  await assert.rejects(verifyRecoveredChilizIntent({ jobId: "other", intent }, account.address),
    /chiliz_recovered_intent_mismatch/);
  const parsed = parseTransaction(intent.rawTransaction);
  const receipt = { transactionHash: intent.txHash, status: "success",
    blockHash, blockNumber: 100n, gasUsed: 150_000n,
    effectiveGasPrice: 2_000_000_000_000n, logs: [] };
  const transaction = { hash: intent.txHash, from: account.address, to: KAYEN_ROUTER,
    input: parsed.data, value: parsed.value, chainId: CHILIZ_CHAIN_ID, nonce: parsed.nonce,
    gas: parsed.gas, maxFeePerGas: parsed.maxFeePerGas,
    maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
    type: "eip1559", blockHash, blockNumber: 100n };
  let reads = 0;
  const mockClient = { getTransactionReceipt: async () => { reads += 1; return receipt; },
    getChainId: async () => CHILIZ_CHAIN_ID,
    getTransaction: async () => transaction,
    getBlock: async ({ blockNumber }) => ({ hash: blockHash, number: blockNumber }),
    request: async ({ method, params }) => {
      assert.equal(method, "eth_getFinalizedBlock");
      assert.deepEqual(params, [-3, false]);
      return { number: "0x65", hash: blockHash };
    },
  };
  const result = await waitForFinalizedChilizReceipt(intent, mockClient, mockClient,
    { timeoutMs: 1_000, pollMs: 1, now: () => 1_000, sleep: async () => {} });
  assert.equal(result, receipt);
  assert.equal(reads, 2);
  await assert.rejects(waitForFinalizedChilizReceipt(intent, mockClient, {
    ...mockClient, request: async () => ({ number: "0x0", hash: blockHash }),
  }, { timeoutMs: 1_000, pollMs: 1, now: () => 1_000, sleep: async () => {} }),
  /chiliz_finalized_rpc_unavailable/);
  await assert.rejects(waitForFinalizedChilizReceipt(intent, mockClient, {
    ...mockClient, getBlock: async ({ blockNumber }) => ({
      hash: blockNumber === 100n ? `0x${"b".repeat(64)}` : blockHash,
      number: blockNumber,
    }),
  }, { timeoutMs: 1_000, pollMs: 1, now: () => 1_000, sleep: async () => {} }),
  /chiliz_secondary_receipt_mismatch/);
});

test("purchase output is derived from receipt transfer logs", async () => {
  const intent = await purchaseIntent();
  const topicAddress = (address) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
  const receipt = { logs: [{ address: token,
    topics: [transferTopic, topicAddress("0x5555555555555555555555555555555555555555"),
      topicAddress(account.address)],
    data: `0x${(123n).toString(16).padStart(64, "0")}`,
  }] };
  assert.equal(purchasedTokenOutput(intent, receipt), "123");
});
