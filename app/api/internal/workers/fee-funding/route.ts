import { env } from "cloudflare:workers";
import { Connection } from "@solana/web3.js";
import { z } from "zod";

import { readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import { prepareUnsignedSolToChzSwap } from "@/lib/server/providers/jupiter-sol-chz-plan";
import { secureTokenEqual, workerUnauthorized } from "@/lib/server/workers/auth";
import { inspectFeeFunding } from "./core";

const noStore = { "Cache-Control": "no-store" };
const bodySchema = z.object({
  action: z.enum(["inspect", "quote"]),
  feeEventId: z.string().min(4).max(160),
  launchId: z.string().min(4).max(160),
}).strict();

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/** This endpoint is separate from the live automation worker and stays off
 * until an operator explicitly enables this narrow planning switch. It never
 * receives a private key, signs, broadcasts, or marks financial readiness. */
export async function POST(request: Request) {
  const token = readWorkerToken();
  if (!token) return reply({ error: "Fee-funding inspection is locked." }, 503);
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || !(await secureTokenEqual(token, supplied))) return workerUnauthorized();

  const featureFlag = (env as unknown as Record<string, unknown>)["SPORTPAD_FEE_FUNDING_PREPARE_ENABLED"];
  if ((featureFlag ?? process.env.SPORTPAD_FEE_FUNDING_PREPARE_ENABLED) !== "true") {
    return reply({ error: "Fee-funding inspection is paused." }, 503);
  }
  if (!env.DB) return reply({ error: "Fee-funding database is unavailable." }, 503);
  const mainnet = readMainnetConfig();
  if (!mainnet.ready || !mainnet.rewardTreasury) {
    return reply({ error: "Configured mainnet treasuries are not ready." }, 503);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "Invalid fee-funding request." }, 400);

  try {
    const inspection = await inspectFeeFunding(env.DB, {
      feeEventId: parsed.data.feeEventId,
      launchId: parsed.data.launchId,
      rewardTreasury: mainnet.rewardTreasury,
      sportpadMint: mainnet.sportpadMint,
    });
    if (parsed.data.action === "inspect") return reply({ ok: true, inspection });
    if (!inspection.nextChunk || inspection.blockedReason) {
      return reply({ error: "This fee's swap chunk is not available.", inspection }, 409);
    }
    const credentials = readProviderCredentials();
    if (!credentials.jupiterApiKey || !credentials.heliusApiKey) {
      return reply({ error: "Jupiter and Helius credentials are required for an unsigned quote." }, 503);
    }
    const connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(credentials.heliusApiKey)}`,
      "finalized",
    );
    // This is read-only: Jupiter order, on-chain account inspection, and
    // simulation. A future authorized worker must independently reserve with
    // the existing atomic DB CAS before it ever signs or broadcasts.
    const intent = await prepareUnsignedSolToChzSwap({
      apiKey: credentials.jupiterApiKey,
      inputLamports: inspection.nextChunk.inputLamports,
      sourceWallet: mainnet.rewardTreasury,
      connection,
    });
    return reply({ ok: true, inspection, intent });
  } catch {
    // Provider failures may include credential-bearing RPC URLs. Keep logs fixed.
    console.error("fee_funding_inspection_failed");
    return reply({ error: "Fee funding could not be verified or quoted." }, 409);
  }
}
