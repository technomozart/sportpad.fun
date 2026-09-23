import { getRewardOption, type RewardChain } from "@/lib/protocol/reward-options";
import { CHILIZ_ASSET_MIGRATION_VERIFIED } from "@/lib/protocol/chiliz-receipts";
import { checkChilizRewardRoute, checkChilizV2Market } from "@/lib/server/providers/chiliz-reward-route";
import { checkRewardRoute } from "@/lib/server/providers/jupiter-reward-route";

type RouteContext = { params: Promise<{ symbol: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { symbol } = await context.params;
  const requestedChain = new URL(request.url).searchParams.get("chain") ?? "chiliz";
  if (requestedChain !== "chiliz" && requestedChain !== "solana") {
    return Response.json({ error: "Unknown reward network." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const chain: RewardChain = requestedChain;
  const asset = getRewardOption(chain, symbol);
  if (!asset) {
    return Response.json({ error: "Unknown reward asset." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (chain === "chiliz" && (!CHILIZ_ASSET_MIGRATION_VERIFIED ||
    asset.routeStatus !== "current_verified")) {
    // A read-only market quote is not permission to spend treasury funds or
    // advertise this reward as claimable. Keep route.available false.
    const market = await checkChilizV2Market(asset.tokenAddress);
    return Response.json({ symbol: asset.symbol, chain, tokenAddress: asset.tokenAddress,
      route: { available: false, checkedAt: new Date().toISOString(), inputAmountWei: "0",
        outputAmountAtomic: null, router: "Kayen", reason: "asset_migration_unverified" },
      market },
    { headers: { "Cache-Control": "no-store" } });
  }
  const route = chain === "chiliz"
    ? await checkChilizRewardRoute(asset.tokenAddress)
    : await checkRewardRoute(asset.tokenAddress);
  return Response.json(
    { symbol: asset.symbol, chain, tokenAddress: asset.tokenAddress, route },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } },
  );
}
