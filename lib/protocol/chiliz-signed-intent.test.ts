import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHILIZ_CHAIN_ID, KAYEN_ROUTER, WRAPPED_CHZ } from "./chiliz-receipts.ts";
import { createChilizSignedIntent, reconcileChilizSignedIntent, verifyChilizPurchasePrincipal,
  verifyPersistedChilizSignedIntent,
  type ChilizReconciliationEvidence, type ChilizSignedIntentRequest } from "./chiliz-signed-intent.ts";

const account = privateKeyToAccount(generatePrivateKey());
const token = "0x4444444444444444444444444444444444444444";
const destination = "0x5555555555555555555555555555555555555555";
const oneChz = 10n ** 18n;
const blockHash = `0x${"a".repeat(64)}`;
const routerAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

test("a Chiliz purchase must fund nearly the full independently quoted 80% amount", () => {
  assert.equal(verifyChilizPurchasePrincipal("990", "990", "1000"), 990n);
  assert.equal(verifyChilizPurchasePrincipal("980", "980", "1000"), 980n);
  assert.throws(() => verifyChilizPurchasePrincipal("1", "1", "1000"), /not_fully_funded/);
  assert.throws(() => verifyChilizPurchasePrincipal("979", "979", "1000"), /not_fully_funded/);
  assert.throws(() => verifyChilizPurchasePrincipal("1001", "1001", "1000"), /not_fully_funded/);
  assert.throws(() => verifyChilizPurchasePrincipal("900", "990", "1000"), /not_fully_funded/);
});

async function purchase(overrides: Record<string, unknown> = {}): Promise<ChilizSignedIntentRequest & { kind: "purchase" }> {
  const signedAtEpochSeconds = 1_800_000_000;
  const deadlineEpochSeconds = signedAtEpochSeconds + 90;
  const rawTransaction = await account.signTransaction({
    chainId: CHILIZ_CHAIN_ID, type: "eip1559", nonce: 7, gas: 200_000n,
    maxFeePerGas: 2_501_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
    to: KAYEN_ROUTER, value: 2n * oneChz,
    data: encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
      args: [100n, [WRAPPED_CHZ, token], account.address, BigInt(deadlineEpochSeconds)] }),
    ...overrides,
  });
  return { kind: "purchase", jobId: "job_1", attempt: 1, treasury: account.address,
    fanTokenContract: token, rawTransaction, gasFeeCeilingWei: oneChz.toString(),
    maxPrincipalWei: (2n * oneChz).toString(), minimumOutputAtomic: "100",
    signedAtEpochSeconds, deadlineEpochSeconds };
}

async function claim(overrides: Record<string, unknown> = {}): Promise<ChilizSignedIntentRequest & { kind: "claim" }> {
  const rawTransaction = await account.signTransaction({
    chainId: CHILIZ_CHAIN_ID, type: "eip1559", nonce: 8, gas: 100_000n,
    maxFeePerGas: 2_501_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
    to: token, value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [destination, 500n] }),
    ...overrides,
  });
  return { kind: "claim", jobId: "job_2", attempt: 1, treasury: account.address,
    fanTokenContract: token, destination, amountAtomic: "500", rawTransaction,
    gasFeeCeilingWei: oneChz.toString() };
}

function chainEvidence(intent: Awaited<ReturnType<typeof createChilizSignedIntent>>): ChilizReconciliationEvidence {
  return {
    chainId: CHILIZ_CHAIN_ID, finalizedBlockNumber: 101n, canonicalReceiptBlockHash: blockHash,
    transaction: {
      hash: intent.txHash, from: account.address,
      to: intent.kind === "purchase" ? KAYEN_ROUTER : token,
      input: intent.kind === "purchase"
        ? encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
          args: [100n, [WRAPPED_CHZ, token], account.address, 1_800_000_090n] })
        : encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [destination, 500n] }),
      value: BigInt(intent.valueWei), chainId: CHILIZ_CHAIN_ID, nonce: intent.nonce,
      gas: BigInt(intent.gasLimit), maxFeePerGas: BigInt(intent.maxFeePerGasWei),
      maxPriorityFeePerGas: BigInt(intent.maxPriorityFeePerGasWei), type: "eip1559",
      blockHash, blockNumber: 100n,
    },
    receipt: { transactionHash: intent.txHash, status: "success", blockHash, blockNumber: 100n,
      gasUsed: 150_000n, effectiveGasPrice: 2_500_000_000_000n },
  };
}

test("canonical signed purchase captures hash, nonce and fee-inclusive maximum before broadcast", async () => {
  const intent = await createChilizSignedIntent(await purchase());
  assert.match(intent.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(intent.nonce, 7);
  assert.equal(intent.valueWei, (2n * oneChz).toString());
  assert.equal(intent.maximumNetworkFeeWei, (200_000n * 2_501_000_000_000n).toString());
  assert.equal(intent.maximumTotalSpendWei, (2n * oneChz + 200_000n * 2_501_000_000_000n).toString());
  assert.deepEqual(await verifyPersistedChilizSignedIntent(intent), intent);
  await assert.rejects(() => verifyPersistedChilizSignedIntent({ ...intent, nonce: 8 }), /chiliz_intent_persisted_mismatch/);
  await assert.rejects(() => verifyPersistedChilizSignedIntent({ ...intent, maximumTotalSpendWei: "0" }), /chiliz_intent_persisted_mismatch/);
});

test("signed purchase cannot alter principal, call target, output minimum, signer or gas budget", async () => {
  const valid = await purchase();
  await assert.rejects(() => createChilizSignedIntent({ ...valid, maxPrincipalWei: oneChz.toString() }), /principal_exceeded/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, minimumOutputAtomic: "101" }), /call_mismatch/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, treasury: destination }), /signer_mismatch/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, gasFeeCeilingWei: "1" }), /network_fee_exceeded/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, gasFeeCeilingWei: (4n * oneChz).toString() }), /fee_ceiling_exceeded/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, deadlineEpochSeconds: 1_800_000_091 }), /call_mismatch/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, attempt: 2 as 1 }), /job_invalid/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, rawTransaction: "0xzz" }), /raw_invalid/);
  const wrongSigner = privateKeyToAccount(generatePrivateKey());
  const otherRaw = await wrongSigner.signTransaction({ chainId: CHILIZ_CHAIN_ID, type: "eip1559",
    nonce: 7, gas: 200_000n, maxFeePerGas: 2_501_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n, to: KAYEN_ROUTER, value: 2n * oneChz,
    data: encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
      args: [100n, [WRAPPED_CHZ, token], account.address, 1_800_000_090n] }) });
  await assert.rejects(() => createChilizSignedIntent({ ...valid, rawTransaction: otherRaw }), /signer_mismatch/);
  const wrongTarget = await purchase({ to: token });
  await assert.rejects(() => createChilizSignedIntent(wrongTarget), /call_mismatch/);
  const wrongChain = await purchase({ chainId: 1 });
  await assert.rejects(() => createChilizSignedIntent(wrongChain), /transaction_invalid/);
  const expensiveGas = await purchase({ gas: 1_000_001n });
  await assert.rejects(() => createChilizSignedIntent(expensiveGas), /transaction_invalid/);
  const legacy = await account.signTransaction({ chainId: CHILIZ_CHAIN_ID, type: "legacy",
    nonce: 7, gas: 200_000n, gasPrice: 2_501_000_000_000n,
    to: KAYEN_ROUTER, value: 2n * oneChz,
    data: encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens",
      args: [100n, [WRAPPED_CHZ, token], account.address, 1_800_000_090n] }) });
  await assert.rejects(() => createChilizSignedIntent({ ...valid, rawTransaction: legacy }), /transaction_invalid/);
});

test("signed claim permits only exact zero-value token transfer to linked destination", async () => {
  const valid = await claim();
  const intent = await createChilizSignedIntent(valid);
  assert.equal(intent.valueWei, "0");
  assert.equal(intent.nonce, 8);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, destination: account.address }), /call_mismatch/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, amountAtomic: "501" }), /call_mismatch/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, fanTokenContract: destination }), /call_mismatch/);
  const nonzeroValue = await claim({ value: 1n });
  await assert.rejects(() => createChilizSignedIntent(nonzeroValue), /claim_value_nonzero/);
  await assert.rejects(() => createChilizSignedIntent({ ...valid, gasFeeCeilingWei: (2n * oneChz).toString() }), /fee_ceiling_exceeded/);
});

test("missing, pending, unfinalized and reorg evidence remain unresolved without retry", async () => {
  const intent = await createChilizSignedIntent(await purchase());
  const complete = chainEvidence(intent);
  assert.deepEqual(await reconcileChilizSignedIntent(intent, { chainId: CHILIZ_CHAIN_ID }),
    { state: "unresolved", txHash: intent.txHash, retryAllowed: false, settlementAllowed: false });
  assert.equal((await reconcileChilizSignedIntent(intent, { ...complete, receipt: null })).state, "unresolved");
  assert.equal((await reconcileChilizSignedIntent(intent, { ...complete, transaction: null })).state, "unresolved");
  assert.equal((await reconcileChilizSignedIntent(intent, { ...complete, finalizedBlockNumber: 99n })).state, "unresolved");
  assert.equal((await reconcileChilizSignedIntent(intent, { ...complete, canonicalReceiptBlockHash: null })).state, "unresolved");
  assert.equal((await reconcileChilizSignedIntent(intent, { ...complete, canonicalReceiptBlockHash: `0x${"b".repeat(64)}` })).state, "unresolved");
});

test("finalized success and revert account for exact bounded gas without authorizing retry", async () => {
  const intent = await createChilizSignedIntent(await purchase());
  const complete = chainEvidence(intent);
  assert.deepEqual(await reconcileChilizSignedIntent(intent, complete), {
    state: "finalized_success", txHash: intent.txHash,
    networkFeeWei: (150_000n * 2_500_000_000_000n).toString(),
    principalSpentWei: (2n * oneChz).toString(),
    totalSpentWei: (2n * oneChz + 150_000n * 2_500_000_000_000n).toString(),
    retryAllowed: false, settlementAllowed: false,
  });
  const reverted = { ...complete, receipt: { ...complete.receipt!, status: "reverted" } };
  assert.deepEqual(await reconcileChilizSignedIntent(intent, reverted), {
    state: "finalized_reverted", txHash: intent.txHash,
    networkFeeWei: (150_000n * 2_500_000_000_000n).toString(),
    principalSpentWei: "0", totalSpentWei: (150_000n * 2_500_000_000_000n).toString(),
    retryAllowed: false, settlementAllowed: false,
  });
});

test("mismatched chain, transaction, receipt or fee never becomes a terminal proof", async () => {
  const intent = await createChilizSignedIntent(await purchase());
  const proof = chainEvidence(intent);
  await assert.rejects(() => reconcileChilizSignedIntent(intent, { ...proof, chainId: 1 }), /chain_mismatch/);
  await assert.rejects(() => reconcileChilizSignedIntent(intent, { ...proof,
    transaction: { ...proof.transaction!, nonce: 8 } }), /transaction_mismatch/);
  await assert.rejects(() => reconcileChilizSignedIntent(intent, { ...proof,
    receipt: { ...proof.receipt!, transactionHash: `0x${"f".repeat(64)}` } }), /receipt_mismatch/);
  await assert.rejects(() => reconcileChilizSignedIntent(intent, { ...proof,
    receipt: { ...proof.receipt!, effectiveGasPrice: 2_502_000_000_000n } }), /fee_exceeded/);
  await assert.rejects(() => reconcileChilizSignedIntent(intent, { ...proof,
    receipt: { ...proof.receipt!, gasUsed: 200_001n } }), /fee_exceeded/);
});
