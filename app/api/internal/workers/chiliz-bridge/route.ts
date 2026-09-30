import { env } from "cloudflare:workers";
import { readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import { handleChilizBridgeWorkerRequest } from "./core";

/** Deliberately separate from mainnet execution and every financial lane. */
export async function POST(request: Request): Promise<Response> {
  const flag = (env as unknown as Record<string, unknown>)
    .SPORTPAD_CHILIZ_BRIDGE_CANARY_WORKER_API_ENABLED;
  const prepareFlag = (env as unknown as Record<string, unknown>)
    .SPORTPAD_CHILIZ_BRIDGE_CANARY_PREPARE_ENABLED;
  const heliusKey = readProviderCredentials().heliusApiKey;
  return handleChilizBridgeWorkerRequest(request, {
    database: env.DB,
    workerToken: readWorkerToken(),
    canaryEnabled: flag === "true",
    prepareEnabled: prepareFlag === "true",
    rewardTreasury: readMainnetConfig().rewardTreasury,
    chilizTreasury: env.CHILIZ_TREASURY_ADDRESS?.trim() ?? null,
    solanaRpcUrl: heliusKey ?
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}` : null,
    primaryChilizRpcUrl: "https://rpc.ankr.com/chiliz",
    secondaryChilizRpcUrl: "https://chiliz-rpc.publicnode.com",
  });
}
