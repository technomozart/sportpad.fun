import { env } from "cloudflare:workers";
import { readWorkerToken } from "@/lib/server/execution-config";
import { handleAfcV2BuyCanaryRequest } from "./core";

/** Completely separate from the reward purchase lane and public readiness. */
export async function POST(request: Request): Promise<Response> {
  const flags = env as unknown as Record<string, unknown>;
  return handleAfcV2BuyCanaryRequest(request, {
    database: env.DB,
    workerToken: readWorkerToken(),
    canaryEnabled: flags.SPORTPAD_AFC_V2_BUY_CANARY_API_ENABLED === "true",
    prepareEnabled: flags.SPORTPAD_AFC_V2_BUY_CANARY_PREPARE_ENABLED === "true",
    chilizTreasury: env.CHILIZ_TREASURY_ADDRESS?.trim() ?? null,
    primaryRpcUrl: env.CHILIZ_RPC_URL?.trim() || "https://rpc.ankr.com/chiliz",
    secondaryRpcUrl: typeof flags.CHILIZ_SECONDARY_RPC_URL === "string" ?
      flags.CHILIZ_SECONDARY_RPC_URL.trim() || "https://chiliz-rpc.publicnode.com" :
      "https://chiliz-rpc.publicnode.com",
  });
}
