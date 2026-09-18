export type RewardAsset = {
  symbol: string;
  name: string;
  solanaMint: string;
  executionStatus: "quoted" | "inventory_required";
  source: string;
};

export const REWARD_ASSETS: ReadonlyArray<RewardAsset> = [
  {
    symbol: "PSG",
    name: "Paris Saint-Germain Fan Token",
    solanaMint: "5eyib4qghYGHNh7VvxSFGYLFJSanjq9hug9fR52kksnm",
    executionStatus: "inventory_required",
    source: "https://docs.chiliz.com/quick-start/token-contract-addresses",
  },
  {
    symbol: "AFC",
    name: "Arsenal Fan Token",
    solanaMint: "Dst93spXQEXxFzwYbFrQRnFYBYpw7AzB2QyALEeP4NGQ",
    executionStatus: "quoted",
    source: "https://docs.chiliz.com/quick-start/token-contract-addresses",
  },
  {
    symbol: "BAR",
    name: "FC Barcelona Fan Token",
    solanaMint: "82DNsTK61ZrgCHP6pfP32Eubcsp9h38d64E6X9ETEBBe",
    executionStatus: "inventory_required",
    source: "https://docs.chiliz.com/quick-start/token-contract-addresses",
  },
  {
    symbol: "CITY",
    name: "Manchester City Fan Token",
    solanaMint: "8WbNQtY7QmXMVKJFTSqFudierVZZtbuoyeepZEqJ1B2w",
    executionStatus: "inventory_required",
    source: "https://docs.chiliz.com/quick-start/token-contract-addresses",
  },
  {
    symbol: "ACM",
    name: "AC Milan Fan Token",
    solanaMint: "H5qGPniSX2uCNtAnxr7RpdfFAZcGkr6dknjgpa1AKHe1",
    executionStatus: "inventory_required",
    source: "https://docs.chiliz.com/quick-start/token-contract-addresses",
  },
];

export function getRewardAsset(symbol: string) {
  return REWARD_ASSETS.find((asset) => asset.symbol === symbol.toUpperCase());
}
