import { getAddress } from "viem";
import { getChilizRewardAsset, KAYEN } from "../../protocol/chiliz-reward-assets.ts";
import { verifyPersistedChilizSignedIntent,
  type ChilizSignedIntent } from "../../protocol/chiliz-signed-intent.ts";

export const AFC_BUY_CANARY_JOB_ID = "afc_v2_buy_canary_initial";
export const AFC_BUY_CANARY_AMOUNT_WEI = "10000000000000000"; // 0.01 CHZ.
export const AFC_BUY_CANARY_MAX_GAS_WEI = "1000000000000000000"; // 1 CHZ.
const MIN_OUTPUT_ATOMIC = 1_000_000_000_000n;
const TOKEN = getChilizRewardAsset("AFC")?.currentV2Contract;
export type AfcBuyCanaryIntent = ChilizSignedIntent & { kind: "purchase" };

function fail(code: string): never { throw new Error(`afc_v2_buy_canary_${code}`); }

/** Validate a signed, canonical EIP-1559 swap against independent one-shot
 * canary bounds. The worker must independently construct a fresh, funded
 * Kayen quote/simulation before signing. No DB or network I/O happens here. */
export async function verifyAfcV2BuyCanaryIntent(input: {
  intent: ChilizSignedIntent;
  expectedTreasury: string;
  nowEpochSeconds?: number;
  /** Only for re-reading a previously persisted/claimed immutable intent. */
  requireFresh?: boolean;
}): Promise<AfcBuyCanaryIntent> {
  let treasury: string;
  try { treasury = getAddress(input.expectedTreasury); }
  catch { return fail("treasury_invalid"); }
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || now <= 0 || !TOKEN) fail("configuration_invalid");
  let verified: ChilizSignedIntent;
  try { verified = await verifyPersistedChilizSignedIntent(input.intent); }
  catch { return fail("signed_intent_invalid"); }
  if (verified.jobId !== AFC_BUY_CANARY_JOB_ID || verified.attempt !== 1 ||
      verified.kind !== "purchase" || verified.treasury !== treasury ||
      getAddress(verified.fanTokenContract) !== getAddress(TOKEN) ||
      getAddress(KAYEN.router) !== "0x1918EbB39492C8b98865c5E53219c3f1AE79e76F" ||
      verified.maxPrincipalWei !== AFC_BUY_CANARY_AMOUNT_WEI ||
      verified.valueWei !== AFC_BUY_CANARY_AMOUNT_WEI ||
      !/^[1-9][0-9]*$/.test(verified.minimumOutputAtomic) ||
      BigInt(verified.minimumOutputAtomic) < MIN_OUTPUT_ATOMIC ||
      !/^[1-9][0-9]*$/.test(verified.gasFeeCeilingWei) ||
      BigInt(verified.gasFeeCeilingWei) > BigInt(AFC_BUY_CANARY_MAX_GAS_WEI) ||
      BigInt(verified.maximumNetworkFeeWei) > BigInt(AFC_BUY_CANARY_MAX_GAS_WEI) ||
      BigInt(verified.maximumTotalSpendWei) >
        BigInt(AFC_BUY_CANARY_AMOUNT_WEI) + BigInt(AFC_BUY_CANARY_MAX_GAS_WEI) ||
      input.requireFresh !== false && (
        verified.signedAtEpochSeconds > now + 5 ||
        verified.signedAtEpochSeconds < now - 30 ||
        verified.deadlineEpochSeconds <= now + 15 ||
        verified.deadlineEpochSeconds > now + 120)) {
    fail("bounds_invalid");
  }
  return verified as AfcBuyCanaryIntent;
}
