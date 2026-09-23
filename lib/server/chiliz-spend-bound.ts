import "server-only";

import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { validateChilizPurchaseSpendQuote } from "@/lib/protocol/chiliz-spend-bound";
import { REPLENISHMENT_ASSETS } from "@/lib/protocol/replenishment";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import { getMainnetConnection } from "@/lib/server/solana/devnet";

const JUPITER_ORDER_ENDPOINT = "https://api.jup.ag/swap/v2/order";

export async function quoteChilizPurchaseSpendCeiling(rewardAmountLamports: string,
  txBlockTimestampMs: number): Promise<string> {
  // Receipt-time accounting check only. A worker holding the treasury key can
  // broadcast without asking this server, so this is not a spend authorization.
  const apiKey = readProviderCredentials().jupiterApiKey;
  if (!apiKey) throw new Error("chiliz_spend_quote_key_missing");

  const connection = getMainnetConnection();
  const mint = new PublicKey(REPLENISHMENT_ASSETS.solanaChzMint);
  const mintAccount = await connection.getAccountInfo(mint, "finalized");
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
    !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) {
    throw new Error("chiliz_spend_quote_chz_mint_unverified");
  }
  const mintState = await getMint(connection, mint, "finalized", mintAccount.owner);
  if (mintState.decimals !== REPLENISHMENT_ASSETS.solanaChzDecimals) {
    throw new Error("chiliz_spend_quote_chz_decimals_mismatch");
  }

  const endpoint = new URL(JUPITER_ORDER_ENDPOINT);
  endpoint.searchParams.set("inputMint", REPLENISHMENT_ASSETS.solMint);
  endpoint.searchParams.set("outputMint", REPLENISHMENT_ASSETS.solanaChzMint);
  endpoint.searchParams.set("amount", rewardAmountLamports);
  const requestedAtMs = Date.now();
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "x-api-key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("chiliz_spend_quote_unavailable");
  const payload: unknown = await response.json().catch(() => null);
  const observedAtMs = Date.now();
  return validateChilizPurchaseSpendQuote(payload, rewardAmountLamports,
    { requestedAtMs, observedAtMs, txBlockTimestampMs }).toString();
}
