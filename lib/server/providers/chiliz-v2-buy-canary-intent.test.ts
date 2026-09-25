import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChilizRewardAsset, KAYEN } from "../../protocol/chiliz-reward-assets.ts";
import { createChilizSignedIntent } from "../../protocol/chiliz-signed-intent.ts";
import { AFC_BUY_CANARY_AMOUNT_WEI, AFC_BUY_CANARY_JOB_ID,
  verifyAfcV2BuyCanaryIntent } from "./chiliz-v2-buy-canary-intent.ts";

const routerAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns (uint256[] amounts)",
]);
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const now = 1_800_000_000;
const token = getChilizRewardAsset("AFC")!.currentV2Contract;

async function signed(overrides: {
  token?: string; amount?: bigint; gas?: bigint; maxFeePerGas?: bigint;
  signedAt?: number; deadline?: number; minimum?: bigint;
} = {}) {
  const selectedToken = (overrides.token ?? token) as `0x${string}`;
  const amount = overrides.amount ?? BigInt(AFC_BUY_CANARY_AMOUNT_WEI);
  const gas = overrides.gas ?? 200_000n;
  const maxFeePerGas = overrides.maxFeePerGas ?? 1_000_000_000n;
  const minimum = overrides.minimum ?? 1_000_000_000_000_000n;
  const signedAt = overrides.signedAt ?? now;
  const deadline = overrides.deadline ?? now + 120;
  const rawTransaction = await account.signTransaction({
    chainId: 88_888, type: "eip1559", nonce: 3, gas,
    maxFeePerGas, maxPriorityFeePerGas: 1_000_000_000n,
    to: KAYEN.router, value: amount,
    data: encodeFunctionData({ abi: routerAbi,
      functionName: "swapExactETHForTokens",
      args: [minimum, [KAYEN.wrappedChz, selectedToken],
        account.address, BigInt(deadline)] }),
  });
  return createChilizSignedIntent({ kind: "purchase",
    jobId: AFC_BUY_CANARY_JOB_ID, attempt: 1,
    treasury: account.address, fanTokenContract: selectedToken,
    maxPrincipalWei: amount.toString(), minimumOutputAtomic: minimum.toString(),
    signedAtEpochSeconds: signedAt, deadlineEpochSeconds: deadline,
    rawTransaction, gasFeeCeilingWei: (gas * maxFeePerGas).toString() });
}

test("accepts exactly signed 0.01 CHZ AFC V2 router purchase under 1 CHZ gas", async () => {
  const intent = await signed();
  const verified = await verifyAfcV2BuyCanaryIntent({ intent,
    expectedTreasury: account.address, nowEpochSeconds: now });
  assert.equal(verified.txHash, intent.txHash);
  assert.equal(verified.valueWei, AFC_BUY_CANARY_AMOUNT_WEI);
});

test("rejects changed token, amount, dust output, high gas, or stale signature", async () => {
  for (const overrides of [
    { token: getChilizRewardAsset("ACM")!.currentV2Contract },
    { amount: 20_000_000_000_000_000n },
    { minimum: 1n },
    { gas: 400_000n, maxFeePerGas: 5_000_000_000_000n },
    { signedAt: now - 31 },
  ]) {
    const intent = await signed(overrides);
    await assert.rejects(verifyAfcV2BuyCanaryIntent({ intent,
      expectedTreasury: account.address, nowEpochSeconds: now }), /canary_bounds_invalid/);
  }
});

test("rejects a different treasury even with a valid signed router call", async () => {
  const intent = await signed();
  const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
  await assert.rejects(verifyAfcV2BuyCanaryIntent({ intent,
    expectedTreasury: other.address, nowEpochSeconds: now }), /canary_bounds_invalid/);
});
