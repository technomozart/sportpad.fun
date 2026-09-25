import { env } from "cloudflare:workers";
import { readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { handleChilizBridgeWorkerRequest } from "./core";

/** Deliberately separate from mainnet execution and every financial lane. */
export async function POST(request: Request): Promise<Response> {
  const flag = (env as unknown as Record<string, unknown>)
    .SPORTPAD_CHILIZ_BRIDGE_CANARY_WORKER_API_ENABLED;
  const prepareFlag = (env as unknown as Record<string, unknown>)
    .SPORTPAD_CHILIZ_BRIDGE_CANARY_PREPARE_ENABLED;
  return handleChilizBridgeWorkerRequest(request, {
    database: env.DB,
    workerToken: readWorkerToken(),
    canaryEnabled: flag === "true",
    prepareEnabled: prepareFlag === "true",
    rewardTreasury: readMainnetConfig().rewardTreasury,
    chilizTreasury: env.CHILIZ_TREASURY_ADDRESS?.trim() ?? null,
  });
}
