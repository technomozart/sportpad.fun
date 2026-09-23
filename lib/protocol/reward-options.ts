import { CHILIZ_REWARD_ASSETS, CHILIZ_V2_MIGRATION_SOURCE } from "./chiliz-reward-assets.ts";
import { REWARD_ASSETS } from "./reward-assets.ts";

export type RewardChain = "chiliz" | "solana";

export type RewardOption = {
  id: string;
  chain: RewardChain;
  symbol: string;
  name: string;
  category: string;
  tokenAddress: string;
  wrappedTokenAddress: string | null;
  legacyTokenAddress?: string;
  legacyWrappedTokenAddress?: string;
  routeStatus: "legacy_unverified" | "current_verified" | "route_check_required";
  imagePath?: string;
  venue: "Kayen" | "Jupiter";
  source: string;
};

const SOLANA_REWARD_SYMBOLS = new Set(["AFC", "ARG"]);

export const SOLANA_REWARD_OPTIONS: ReadonlyArray<RewardOption> = REWARD_ASSETS
  .filter((asset) => SOLANA_REWARD_SYMBOLS.has(asset.symbol))
  .map((asset) => ({
    id: `solana:${asset.symbol}`,
    chain: "solana" as const,
    symbol: asset.symbol,
    name: asset.name,
    category: asset.category,
    tokenAddress: asset.solanaMint,
    wrappedTokenAddress: null,
    routeStatus: "route_check_required" as const,
    imagePath: asset.imagePath,
    venue: "Jupiter" as const,
    source: asset.source,
  }));

export const CHILIZ_REWARD_OPTIONS: ReadonlyArray<RewardOption> = CHILIZ_REWARD_ASSETS.map((asset) => ({
  id: `chiliz:${asset.symbol}`,
  chain: "chiliz" as const,
  symbol: asset.symbol,
  name: asset.name,
  category: asset.category,
  // Only the official V2 contract identifies a current Fan Token. Kayen's
  // historical wrapper has no verified unwrap path to it, so no route is
  // selectable until a new acquisition and payout path is audited.
  tokenAddress: asset.currentV2Contract,
  wrappedTokenAddress: null,
  legacyTokenAddress: asset.contract,
  legacyWrappedTokenAddress: asset.wrappedContract,
  routeStatus: asset.routeStatus,
  imagePath: asset.imagePath,
  venue: "Kayen" as const,
  source: CHILIZ_V2_MIGRATION_SOURCE,
}));

export const REWARD_OPTIONS: ReadonlyArray<RewardOption> = [
  ...CHILIZ_REWARD_OPTIONS,
  ...SOLANA_REWARD_OPTIONS,
];

export function getRewardOption(chain: RewardChain, symbol: string) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  return REWARD_OPTIONS.find((asset) => asset.chain === chain && asset.symbol === normalizedSymbol);
}

export function parseRewardOptionId(id: string) {
  const [chain, symbol] = id.split(":", 2);
  if ((chain !== "chiliz" && chain !== "solana") || !symbol) return null;
  return getRewardOption(chain, symbol) ?? null;
}
