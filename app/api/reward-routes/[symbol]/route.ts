import { getRewardAsset } from "@/lib/protocol/reward-assets";
import { checkRewardRoute } from "@/lib/server/providers/jupiter-reward-route";

type RouteContext = { params: Promise<{ symbol: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { symbol } = await context.params;
  const asset = getRewardAsset(symbol);
  if (!asset) {
    return Response.json({ error: "Unknown reward asset." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const route = await checkRewardRoute(asset.solanaMint);
  return Response.json(
    { symbol: asset.symbol, mint: asset.solanaMint, route },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } },
  );
}
