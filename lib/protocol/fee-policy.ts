export type LaunchFeePolicy = "community_80_20" | "sportpad_development";

export function launchFeePolicy(launchMint: string, sportpadMint: string | null): LaunchFeePolicy {
  const normalizedLaunchMint = launchMint.trim();
  const normalizedSportpadMint = sportpadMint?.trim() ?? "";
  return normalizedSportpadMint && normalizedLaunchMint === normalizedSportpadMint
    ? "sportpad_development"
    : "community_80_20";
}

export function isCommunityLaunchFeeSource(launchMint: string, sportpadMint: string | null) {
  return launchFeePolicy(launchMint, sportpadMint) === "community_80_20";
}
