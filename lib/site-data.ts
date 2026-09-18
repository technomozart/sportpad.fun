import { REWARD_ASSETS } from "@/lib/protocol/reward-assets";

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
  imagePath?: string;
  isExample: boolean;
};

/**
 * These cards explain the product before the first public launch exists.
 * Public launch data will replace this array as soon as the publish pipeline
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
// published records. Feed consumers omit them as soon as a live record exists.
export const launches = exampleLaunches;

export type FanAsset = {
  symbol: string;
  name: string;
  category: string;
  mint: string;
  imagePath: string;
  status: "Registry listed";
  route: "Not enabled";
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
  route: "Not enabled",
  vault: "Not deployed",
  source: asset.source,
  color: assetColors[asset.symbol] ?? "#9cff57",
}));

export const faqItems = [
  {
    question: "Which assets are official Fan Tokens?",
    answer: "The reward registry contains official sports organization Fan Tokens with exact Solana mints published by Chiliz. A SportPad community coin is a separate asset created by its own creator.",
  },
  {
    question: "Why can rewards use the same Solana wallet?",
    answer: "The official registry publishes Solana mints for the listed Fan Tokens. Once SportPad deploys and funds its claim system, supported rewards can be sent to a holder's existing Solana address without requiring MetaMask.",
  },
  {
    question: "What happens to creator fees?",
    answer: "The planned configuration assigns 80% of eligible creator fees to official Fan Token rewards and 20% to SPORTPAD buybacks and burns. Mainnet fee routing is not deployed yet.",
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
    answer: "The official Solana mint is known, but SportPad has not yet deployed or funded a reward vault or enabled an acquisition route for that asset.",
  },
];

export function getLaunch(slug: string) {
  return launches.find((launch) => launch.slug === slug);
}
