import "server-only";

import { env } from "cloudflare:workers";

import { normalizeSolanaAddress } from "@/lib/protocol/wallet-auth";

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

export type MainnetConfig = {
  enabled: boolean;
  rewardTreasury: string | null;
  buybackTreasury: string | null;
  sportpadMint: string | null;
  ready: boolean;
  missing: string[];
};

export function readMainnetConfig(): MainnetConfig {
  const enabled = firstNonEmpty(env.MAINNET_EXECUTION_ENABLED, process.env.MAINNET_EXECUTION_ENABLED) === "true";
  const rewardTreasury = normalizeSolanaAddress(firstNonEmpty(
    env.SOLANA_REWARD_TREASURY_ADDRESS,
    process.env.SOLANA_REWARD_TREASURY_ADDRESS,
  ) ?? "");
  const buybackTreasury = normalizeSolanaAddress(firstNonEmpty(
    env.SOLANA_BUYBACK_TREASURY_ADDRESS,
    process.env.SOLANA_BUYBACK_TREASURY_ADDRESS,
  ) ?? "");
  const sportpadMint = normalizeSolanaAddress(firstNonEmpty(
    env.SPORTPAD_MINT_ADDRESS,
    process.env.SPORTPAD_MINT_ADDRESS,
  ) ?? "");
  const missing: string[] = [];
  if (!enabled) missing.push("mainnet execution approval");
  if (!rewardTreasury) missing.push("80% reward treasury address");
  if (!buybackTreasury) missing.push("20% buyback treasury address");
  if (rewardTreasury && buybackTreasury && rewardTreasury === buybackTreasury) {
    missing.push("two distinct treasury addresses");
  }
  return {
    enabled,
    rewardTreasury,
    buybackTreasury,
    sportpadMint,
    ready: missing.length === 0,
    missing,
  };
}
