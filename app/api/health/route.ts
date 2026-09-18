import { REWARD_ASSETS } from "@/lib/protocol/reward-assets";

export async function GET() {
  return Response.json({
    status: "ok",
    mode: "private-prototype",
    rewardAssets: REWARD_ASSETS.map(({ symbol, solanaMint, executionStatus }) => ({
      symbol,
      solanaMint,
      executionStatus,
    })),
    mainnetExecution: false,
  });
}
