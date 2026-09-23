import { REWARD_OPTIONS, type RewardChain } from "@/lib/protocol/reward-options";
import type { PublicDevnetReceipt } from "@/lib/protocol/public-devnet-launch";
import type { PublicMainnetReceipt } from "@/lib/protocol/public-mainnet-launch";

export type Launch = {
  slug: string;
  name: string;
  ticker: string;
  sport: "Football" | "Combat" | "Motorsport" | "Basketball";
  narrative: string;
  rewardSymbol: string;
  rewardChain: RewardChain;
  rewardName: string;
  tone: string;
  description: string;
  website?: string;
  social?: string;
  imagePath?: string;
  isExample: boolean;
  devnet?: PublicDevnetReceipt;
  mainnet?: PublicMainnetReceipt;
};

/**
 * These cards explain the product before the first public launch receipt exists.
 * Public receipt data will replace this array as soon as the publish pipeline
 * is enabled. They contain no price, volume, holder, funding, or timing data.
 */
export const exampleLaunches: Launch[] = [
  {
    slug: "catalan-cats-example",
    name: "Catalan Cats",
    ticker: "CATALA",
    sport: "Football",
    narrative: "Matchday meme concept",
    rewardSymbol: "BAR",
    rewardChain: "chiliz",
    rewardName: "FC Barcelona",
    tone: "#9cff57",
    description: "An example of a supporter-created football meme whose eligible holders could earn official BAR Fan Tokens after the reward system is deployed and funded.",
    isExample: true,
  },
  {
    slug: "paris-ultras-example",
    name: "Paris Ultras",
    ticker: "ULTRA",
    sport: "Football",
    narrative: "Supporter culture concept",
    rewardSymbol: "PSG",
    rewardChain: "chiliz",
    rewardName: "Paris Saint-Germain",
    tone: "#72a7ff",
    description: "An example community concept showing how an independent Solana token could reference official PSG Fan Token rewards.",
    isExample: true,
  },
  {
    slug: "fight-night-example",
    name: "Fight Night Degen",
    ticker: "FND",
    sport: "Combat",
    narrative: "Fight week concept",
    rewardSymbol: "UFC",
    rewardChain: "chiliz",
    rewardName: "UFC",
    tone: "#d9c7ff",
    description: "An example showing that the reward registry can support combat sports as well as football.",
    isExample: true,
  },
];

// Static examples are used only after the public feed confirms there are no
// published receipts. Feed consumers omit them as soon as one exists.
export const launches = exampleLaunches;

export type FanAsset = {
  id: string;
  chain: RewardChain;
  symbol: string;
  name: string;
  category: string;
  mint: string;
  currentTokenAddress: string;
  routeStatus: "legacy_unverified" | "current_verified" | "route_check_required";
  imagePath?: string;
  status: "Official V2 address; route unverified" | "Registry-verified address";
  route: "Kayen" | "Jupiter";
  vault: "Created on funding";
  source: string;
  color: string;
};

const assetColors: Record<string, string> = {
  ACM: "#ff6666",
  AFC: "#ffb84d",
  BAR: "#9cff57",
  CITY: "#66e4ff",
  PSG: "#72a7ff",
  UFC: "#d9c7ff",
};

export const fanAssets: FanAsset[] = REWARD_OPTIONS.map((asset) => ({
  id: asset.id,
  chain: asset.chain,
  symbol: asset.symbol,
  name: asset.name,
  category: asset.category,
  mint: asset.tokenAddress,
  currentTokenAddress: asset.tokenAddress,
  routeStatus: asset.routeStatus,
  imagePath: asset.imagePath,
  status: asset.routeStatus === "legacy_unverified"
    ? "Official V2 address; route unverified"
    : "Registry-verified address",
  route: asset.venue,
  vault: "Created on funding",
  source: asset.source,
  color: assetColors[asset.symbol] ?? "#9cff57",
}));

export const faqItems = [
  {
    question: "Which assets are official Fan Tokens?",
    answer: "The reward registry contains official sports organization Fan Tokens published by Chiliz. They are rooted in the Chiliz ecosystem and can exist across Chiliz Chain, Solana, and Base through an omnichain supply model. A SportPad community coin is a separate asset created by its own creator.",
  },
  {
    question: "Why do Chiliz rewards need MetaMask?",
    answer: "The community token and holder tracking remain on Solana, but most listed Fan Token markets are on Chiliz Chain. A Chiliz claim requires a separately verified 0x wallet. The dashboard can request a switch to Chiliz Chain; a wallet-verification signature grants no spending permission. Payouts remain unavailable until the treasury and claim worker are funded and enabled.",
  },
  {
    question: "What happens to creator fees?",
    answer: "The proposed Pump configuration sends 80% of a community launch's creator fees to a reward treasury and 20% to a separate SPORTPAD buyback treasury. Those transfers alone do not buy Fan Tokens or burn SPORTPAD; each action requires funded, verified execution. SPORTPAD's own creator fees are reserved for project development.",
  },
  {
    question: "Are rewards instant?",
    answer: "No. A reward would become claimable only after fee finality, Fan Token acquisition, holder indexing, a funded epoch, and allocation checks. No claim is owed merely because a creator selected a reward token, and claims are currently paused.",
  },
  {
    question: "How will holder rewards be calculated?",
    answer: "The method uses eligible token-seconds: a wallet's time-weighted balance divided by all eligible time-weighted balances, multiplied by the official Fan Tokens funded for that epoch.",
  },
  {
    question: "Can Chiliz Fan Tokens trade, and can creators select them?",
    answer: "Creators can select any of the 78 official Chiliz V2 Fan Tokens in a private launch draft. A read-only market quote may be shown where liquidity exists, but it does not verify SportPad's automatic purchase or claim execution. Chiliz reward drafts cannot launch on mainnet yet. AFC and ARG remain the two Solana reward options, and all new mainnet launches remain paused pending financial verification. The community coin would trade against SOL on Pump; the selected Fan Token is a planned reward, not its market pair.",
  },
  {
    question: "Does SportPad custody my launch tokens?",
    answer: "Community tokens stay in the user's wallet. If reward execution is enabled, acquired Fan Tokens would be held in protocol-controlled vaults until allocated holders claim them. No reward inventory is currently funded.",
  },
  {
    question: "Who pays the Chiliz claim gas?",
    answer: "The planned claim worker would pay CHZ gas to transfer the current V2 Fan Token directly to a holder's verified 0x address. A holder should not need CHZ merely to claim once that service is active. Chiliz payouts are not yet enabled or funded.",
  },
];

export function getLaunch(slug: string) {
  return launches.find((launch) => launch.slug === slug);
}
