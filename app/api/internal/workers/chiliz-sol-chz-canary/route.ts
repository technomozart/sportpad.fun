import { env } from "cloudflare:workers";
import { Connection } from "@solana/web3.js";
import { z } from "zod";

import { readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import {
  claimCanaryBroadcast, finalizeCanaryJournal, inspectCanaryJournal,
  prepareCanaryJournal,
} from "@/lib/server/providers/chiliz-sol-chz-canary-journal";
import type { CanarySignedInput } from "@/lib/server/providers/chiliz-sol-chz-canary-intent";
import { secureTokenEqual, workerUnauthorized } from "@/lib/server/workers/auth";

const noStore = { "Cache-Control": "no-store" };
const operation = z.enum(["ata_setup", "sol_chz_swap"]);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), operation }).strict(),
  z.object({ action: z.literal("prepare"), operation,
    signed: z.object({ plan: z.record(z.string(), z.unknown()),
      signedTransactionBase64: z.string().min(100).max(4096),
      signedTransactionSha256: z.string().length(64),
      transactionMessageHash: z.string().length(64),
      sourceSignature: z.string().min(64).max(88),
      executionReady: z.literal(false),
    }).passthrough() }).strict(),
  z.object({ action: z.literal("claim"), operation,
    signature: z.string().min(64).max(88) }).strict(),
  z.object({ action: z.literal("finalize"), operation,
    signature: z.string().min(64).max(88) }).strict(),
]);
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/** This isolated endpoint cannot enable public launches. It only durably
 * records a single tightly capped signed canary and commits one-way broadcast
 * state before handing the exact stored bytes back to the Solana worker. */
export async function POST(request: Request) {
  const token = readWorkerToken();
  if (!token) return reply({ error: "Canary journal is locked." }, 503);
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || !(await secureTokenEqual(token, supplied))) return workerUnauthorized();
  const flag = (env as unknown as Record<string, unknown>).SPORTPAD_CHZ_SOLANA_CANARY_API_ENABLED;
  if ((flag ?? process.env.SPORTPAD_CHZ_SOLANA_CANARY_API_ENABLED) !== "true") {
    return reply({ error: "Solana CHZ canary is paused." }, 503);
  }
  if (!env.DB) return reply({ error: "Canary database is unavailable." }, 503);
  const treasury = readMainnetConfig().rewardTreasury;
  if (!treasury) return reply({ error: "Configured reward treasury is unavailable." }, 503);
  let body: unknown = null;
  try {
    const raw = await request.text();
    if (raw.length > 30_000) return reply({ error: "Invalid canary request." }, 400);
    body = JSON.parse(raw);
  } catch { return reply({ error: "Invalid canary request." }, 400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "Invalid canary request." }, 400);
  const action = parsed.data;
  if (action.action === "inspect") {
    try { return reply({ ok: true, journal: await inspectCanaryJournal(env.DB, action.operation) }); }
    catch { return reply({ error: "Canary journal could not be inspected." }, 503); }
  }
  const key = readProviderCredentials().heliusApiKey;
  if (!key) return reply({ error: "Helius RPC is unavailable." }, 503);
  const connection = new Connection(
    `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`, "finalized");
  try {
    if (action.action === "prepare") {
      const enabled = (env as unknown as Record<string, unknown>)
        .SPORTPAD_CHZ_SOLANA_CANARY_PREPARE_ENABLED;
      if ((enabled ?? process.env.SPORTPAD_CHZ_SOLANA_CANARY_PREPARE_ENABLED) !== "true") {
        return reply({ error: "Canary preparation is paused." }, 503);
      }
      const saved = await prepareCanaryJournal({ db: env.DB, connection,
        configuredRewardTreasury: treasury,
        request: { operation: action.operation,
          signed: action.signed } as CanarySignedInput });
      return reply({ ok: true, journal: saved });
    }
    if (action.action === "claim") {
      const claimed = await claimCanaryBroadcast({ db: env.DB, connection,
        operation: action.operation, signature: action.signature });
      return reply({ ok: true, broadcast: claimed });
    }
    const finalized = await finalizeCanaryJournal({ db: env.DB, connection,
      operation: action.operation, signature: action.signature });
    return reply({ ok: true, journal: finalized });
  } catch {
    // RPC errors can embed the URL/API key. Never log an exception here.
    console.error("chz_solana_canary_step_failed");
    return reply({ error: "Canary step failed or cannot be verified; do not retry a broadcast." }, 409);
  }
}
