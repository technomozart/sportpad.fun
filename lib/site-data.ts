import { REWARD_ASSETS, type RewardAsset } from "@/lib/protocol/reward-assets";

export type Launch = {
  slug: string;
  name: string;
  ticker: string;
  sport: "Football" | "Combat" | "Motorsport";
  narrative: string;
  rewardSymbol: string;
  rewardName: string;
  tone: string;
  marketCap: number;
  volume24h: number;
  change24h: number;
  holders: number;
  curve: number;
  rewardsFunded: number;
  rewardUsd: number;
  availability: "routed" | "inventory" | "researching";
  age: string;
  description: string;
  activity: number[];
};

export const launches: Launch[] = [
  {
    slug: "catalan-cats",
    name: "Catalan Cats",
    ticker: "CATALA",
    sport: "Football",
    narrative: "Matchday meme",
    rewardSymbol: "BAR",
    rewardName: "FC Barcelona Fan Token",
    tone: "#9cff57",
    marketCap: 184200,
    volume24h: 42890,
    change24h: 31.4,
    holders: 1284,
    curve: 72,
    rewardsFunded: 428.21,
    rewardUsd: 1738,
    availability: "inventory",
    age: "4h",
    description: "A supporter-made Catalan matchday coin whose creator-fee allocation is linked to verified BAR reward inventory.",
    activity: [18, 34, 30, 55, 48, 72, 65, 88, 79, 95, 91, 98],
  },
  {
    slug: "paris-ultras",
    name: "Paris Ultras",
    ticker: "ULTRA",
    sport: "Football",
    narrative: "Supporter culture",
    rewardSymbol: "PSG",
    rewardName: "Paris Saint-Germain Fan Token",
    tone: "#72a7ff",
    marketCap: 96200,
    volume24h: 28410,
    change24h: 18.8,
    holders: 782,
    curve: 46,
    rewardsFunded: 211.4,
    rewardUsd: 1112,
    availability: "inventory",
    age: "11h",
    description: "A community token for Paris football culture with a Solana-native PSG reward route in the protocol preview.",
    activity: [24, 42, 38, 31, 60, 54, 74, 67, 83, 78, 90, 86],
  },
  {
    slug: "cityzens-onchain",
    name: "Cityzens Onchain",
    ticker: "CITYZ",
    sport: "Football",
    narrative: "Blue-side community",
    rewardSymbol: "CITY",
    rewardName: "Manchester City Fan Token",
    tone: "#66e4ff",
    marketCap: 71800,
    volume24h: 17390,
    change24h: 9.6,
    holders: 644,
    curve: 38,
    rewardsFunded: 186.05,
    rewardUsd: 602,
    availability: "inventory",
    age: "1d",
    description: "A blue-side football community coin associated with official CITY rewards after inventory is funded.",
    activity: [12, 24, 22, 44, 37, 53, 49, 68, 61, 72, 69, 81],
  },
  {
    slug: "rossoneri-run",
    name: "Rossoneri Run",
    ticker: "ROSSO",
    sport: "Football",
    narrative: "European nights",
    rewardSymbol: "ACM",
    rewardName: "AC Milan Fan Token",
    tone: "#ff6666",
    marketCap: 42600,
    volume24h: 9940,
    change24h: 6.2,
    holders: 412,
    curve: 24,
    rewardsFunded: 94.8,
    rewardUsd: 218,
    availability: "inventory",
    age: "2d",
    description: "A supporter-created tribute to red-and-black European nights with ACM reward accounting.",
    activity: [18, 15, 32, 27, 48, 42, 38, 59, 55, 64, 60, 67],
  },
  {
    slug: "north-london-cannon",
    name: "North London Cannon",
    ticker: "CANNON",
    sport: "Football",
    narrative: "Title-race energy",
    rewardSymbol: "AFC",
    rewardName: "Arsenal Fan Token",
    tone: "#ffb84d",
    marketCap: 128400,
    volume24h: 31120,
    change24h: 22.1,
    holders: 901,
    curve: 58,
    rewardsFunded: 319.7,
    rewardUsd: 946,
    availability: "routed",
    age: "7h",
    description: "A title-race community coin with an AFC reward route designed to stay entirely on Solana.",
    activity: [17, 29, 44, 39, 53, 61, 58, 74, 71, 87, 81, 92],
  },
  {
    slug: "fight-night-degen",
    name: "Fight Night Degen",
    ticker: "FND",
    sport: "Combat",
    narrative: "Fight-week culture",
    rewardSymbol: "UFC",
    rewardName: "UFC Fan Token",
    tone: "#d9c7ff",
    marketCap: 33400,
    volume24h: 7680,
    change24h: -3.8,
    holders: 298,
    curve: 19,
    rewardsFunded: 0,
    rewardUsd: 0,
    availability: "researching",
    age: "3d",
    description: "A fight-week culture coin showing how SportPad can extend beyond football into combat sports.",
    activity: [48, 43, 51, 46, 41, 38, 44, 35, 40, 31, 37, 34],
  },
];

export type FanAsset = {
  symbol: string;
  name: string;
  category: string;
  mint: string;
  status: "Route available" | "Inventory required" | "Researching";
  route: string;
  color: string;
};

const fanAssetPresentation: Record<string, Pick<FanAsset, "name" | "category" | "color">> = {
  PSG: { name: "Paris Saint-Germain", category: "Football", color: "#72a7ff" },
  AFC: { name: "Arsenal", category: "Football", color: "#ffb84d" },
  BAR: { name: "FC Barcelona", category: "Football", color: "#9cff57" },
  CITY: { name: "Manchester City", category: "Football", color: "#66e4ff" },
  ACM: { name: "AC Milan", category: "Football", color: "#ff6666" },
};

function executionPresentation(status: RewardAsset["executionStatus"]): Pick<FanAsset, "status" | "route"> {
  return status === "quoted"
    ? { status: "Route available", route: "Solana quote route" }
    : { status: "Inventory required", route: "Pre-funded vault" };
}

export const fanAssets: FanAsset[] = [
  ...REWARD_ASSETS.map((asset) => ({
    symbol: asset.symbol,
    mint: asset.solanaMint,
    ...(fanAssetPresentation[asset.symbol] ?? { name: asset.name, category: "Sports", color: "#9cff57" }),
    ...executionPresentation(asset.executionStatus),
  })),
  { symbol: "UFC", name: "UFC", category: "Combat", mint: "Registry verification pending", status: "Researching", route: "Not enabled", color: "#d9c7ff" },
];

export const feeEvents = [
  { id: "SP-10482", time: "14 sec ago", launch: "$CATALA", kind: "Reward reserve", amount: "2.84 BAR", state: "Allocated", signature: "5kP…91x" },
  { id: "SP-10481", time: "31 sec ago", launch: "$CANNON", kind: "Buyback batch", amount: "0.42 SOL", state: "Queued", signature: "9vQ…h2e" },
  { id: "SP-10480", time: "46 sec ago", launch: "$ULTRA", kind: "Creator fee", amount: "2.10 SOL", state: "Finalized", signature: "3mA…7Jp" },
  { id: "SP-10479", time: "2 min ago", launch: "$CITYZ", kind: "Epoch funding", amount: "41.05 CITY", state: "Funded", signature: "7dL…4ww" },
  { id: "SP-10478", time: "6 min ago", launch: "$ROSSO", kind: "SPORT burn", amount: "18,440 SPORT", state: "Verified", signature: "2Hz…Q8c" },
  { id: "SP-10477", time: "12 min ago", launch: "$CATALA", kind: "Reward claim", amount: "0.81 BAR", state: "Claimed", signature: "8Xn…r13" },
];

export const fixtures = [
  { date: "SEP 20", competition: "League", home: "Barcelona", away: "Getafe", linked: "$CATALA → BAR", countdown: "2d 08h" },
  { date: "SEP 21", competition: "League", home: "Arsenal", away: "Man City", linked: "$CANNON → AFC", countdown: "3d 11h" },
  { date: "SEP 22", competition: "League", home: "Paris", away: "Marseille", linked: "$ULTRA → PSG", countdown: "4d 14h" },
];

export const faqItems = [
  { question: "Is a SportPad coin an official club token?", answer: "No. A launch coin is a community-created Solana token. It can be linked to rewards denominated in an official Fan Token, but that does not make the launch coin official or endorsed by a club, league, Chiliz, Socios.com, or FanTokens." },
  { question: "Why can rewards use the same Solana wallet?", answer: "Several official Fan Tokens now have verified Solana representations. When a selected asset has a usable Solana route or pre-funded inventory, the reward can be delivered to the holder’s existing Solana address without asking for MetaMask." },
  { question: "What happens to creator fees?", answer: "The intended configuration assigns 80% of eligible creator fees to fan-token reward inventory and 20% to SPORT buybacks and burns. Every stage is tracked separately: observed, finalized, allocated, funded, claimable, and claimed." },
  { question: "Are rewards instant?", answer: "No. Claims settle in epochs. Small fees are batched, swaps can be unavailable, and some assets require treasury inventory. The interface must show pending, funded, and claimable balances honestly instead of promising zero delay." },
  { question: "How are holder rewards calculated?", answer: "Each funded epoch is allocated by eligible token-seconds: your time-weighted holding divided by all eligible time-weighted holdings, multiplied by the fan tokens funded for that epoch. Protocol and liquidity accounts are excluded." },
  { question: "Can a creator choose any fan token?", answer: "A creator can select only an allowlisted reward asset. Each asset must have a verified mint, legal review, an execution route or inventory policy, and a tested payout path before it can be enabled." },
  { question: "Does SportPad custody my launch tokens?", answer: "The target design is non-custodial for users. Your wallet holds the launch token and receives claims. Protocol treasuries temporarily custody fee proceeds and reward inventory under capped, policy-controlled signers." },
  { question: "What does ‘inventory required’ mean?", answer: "The official Solana mint exists, but a reliable direct swap may not. SportPad must pre-fund a capped reward vault or replenish it asynchronously before that asset can support claims." },
];

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function getLaunch(slug: string) {
  return launches.find((launch) => launch.slug === slug);
}
