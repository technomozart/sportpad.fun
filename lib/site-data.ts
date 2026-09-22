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
  imagePath?: string;
  status: "Funded route";
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
  imagePath: asset.imagePath,
  status: "Funded route",
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
    answer: "The community token and holder tracking remain on Solana, but most liquid Fan Token markets are on Chiliz Chain. The dashboard verifies a 0x wallet with one message, adds Chiliz Chain when needed, and pays claims to that address without asking for spending permission.",
  },
  {
    question: "What happens to creator fees?",
    answer: "Each verified community launch locks its Pump creator-fee configuration to send 80% to the selected official Fan Token reward treasury and 20% to buy and burn SPORTPAD. SPORTPAD's own creator fees are excluded from that route and retained for project development.",
  },
  {
    question: "Are rewards instant?",
    answer: "No. The system settles rewards in funded epochs after finality, acquisition, holder indexing, and allocation checks. A claim is shown only after inventory has been acquired and reserved.",
  },
  {
    question: "How will holder rewards be calculated?",
    answer: "The method uses eligible token-seconds: a wallet's time-weighted balance divided by all eligible time-weighted balances, multiplied by the official Fan Tokens funded for that epoch.",
  },
  {
    question: "Can a creator choose any Fan Token?",
    answer: "A creator can choose any of the 78 Fan Tokens with live Kayen routes on Chiliz Chain, plus AFC and ARG on Solana. SportPad checks the selected route again before mainnet preparation. A live market is not the same as inventory already held for claims.",
  },
  {
    question: "Does SportPad custody my launch tokens?",
    answer: "Community tokens stay in the user's wallet. Acquired reward inventory is held in policy-controlled protocol vaults until allocated holders claim it.",
  },
  {
    question: "Who pays the Chiliz claim gas?",
    answer: "The automated SportPad treasury pays CHZ gas for the unwrap and payout transaction. The holder receives the allocated official Fan Token and does not need CHZ merely to claim.",
  },
];

export function getLaunch(slug: string) {
  return launches.find((launch) => launch.slug === slug);
}
