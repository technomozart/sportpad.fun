import { REWARD_ASSETS } from "@/lib/protocol/reward-assets";
import type { PublicDevnetReceipt } from "@/lib/protocol/public-devnet-launch";
import type { PublicMainnetReceipt } from "@/lib/protocol/public-mainnet-launch";

export type Launch = {
  slug: string;
  name: string;
  ticker: string;
  sport: "Football" | "Combat" | "Motorsport" | "Basketball";
  narrative: string;
  rewardSymbol: string;
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
  symbol: string;
  name: string;
  category: string;
  mint: string;
  imagePath: string;
  status: "Registry listed";
  route: "Checked at launch";
  vault: "Not deployed";
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

export const fanAssets: FanAsset[] = REWARD_ASSETS.map((asset) => ({
  symbol: asset.symbol,
  name: asset.name,
  category: asset.category,
  mint: asset.solanaMint,
  imagePath: asset.imagePath,
  status: "Registry listed",
  route: "Checked at launch",
  vault: "Not deployed",
  source: asset.source,
  color: assetColors[asset.symbol] ?? "#9cff57",
}));

export const faqItems = [
  {
    question: "Which assets are official Fan Tokens?",
    answer: "The reward registry contains official sports organization Fan Tokens published by Chiliz. They are rooted in the Chiliz ecosystem and can exist across Chiliz Chain, Solana, and Base through an omnichain supply model. A SportPad community coin is a separate asset created by its own creator.",
  },
  {
    question: "Why can rewards use the same Solana wallet?",
    answer: "The official registry publishes Solana token addresses for the listed Fan Tokens. Once SportPad deploys and funds its claim system, supported rewards can be sent to a holder's existing Solana address without requiring MetaMask.",
  },
  {
    question: "What happens to creator fees?",
    answer: "Each verified mainnet launch locks its Pump creator-fee configuration to send 80% to the selected official Fan Token reward treasury and 20% to the SPORTPAD buyback treasury. Automated fee collection, reward purchases, holder accounting, claims, and burns remain separate deployment stages.",
  },
  {
    question: "Are rewards instant?",
    answer: "No. The planned system settles rewards in funded epochs after finality, acquisition, and allocation checks. No reward positions or claims exist while mainnet execution is disabled.",
  },
  {
    question: "How will holder rewards be calculated?",
    answer: "The proposed method uses eligible token-seconds: a wallet's time-weighted balance divided by all eligible time-weighted balances, multiplied by the official Fan Tokens funded for that epoch.",
  },
  {
    question: "Can a creator choose any Fan Token?",
    answer: "A creator can currently choose a registry-listed reward asset. A listing verifies identity only. Every route, vault, and payout path must still be deployed and checked before real rewards can begin.",
  },
  {
    question: "Does SportPad custody my launch tokens?",
    answer: "The planned design keeps community tokens in the user's wallet. Reward inventory would be held in policy-controlled protocol vaults only after that infrastructure is deployed.",
  },
  {
    question: "What does not enabled mean?",
    answer: "The official Fan Token's Solana address is known, but a launch can proceed only when SportPad finds a live Jupiter acquisition route. Reward vaults and holder claims still require separate deployed infrastructure.",
  },
];

export function getLaunch(slug: string) {
  return launches.find((launch) => launch.slug === slug);
}
