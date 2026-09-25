import { env } from "cloudflare:workers";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAddress } from "viem";
import { z } from "zod";
import { readWorkerToken } from "@/lib/server/execution-config";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import {
  claimRepeatBridgeAttempt, prepareRepeatBridgeAttempt,
  reconcileRepeatBridgeDelivery,
} from "@/lib/server/chiliz-repeat-bridge-adapter";
import { independentChilizRpcOrigins } from
  "@/lib/server/chiliz-repeat-bridge-rpc";
import type { UnsignedDirectOftChzTransfer } from
  "@/lib/server/providers/chiliz-direct-oft-build";

const ID = /^[A-Za-z0-9:_-]{1,128}$/;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), bridgeId: z.string().regex(ID),
    workerId: z.string() }).strict(),
  z.object({ action: z.literal("prepare"), bridgeId: z.string().regex(ID),
    attemptSequence: z.number().int().min(0),
    workerId: z.string(), plan: z.record(z.unknown()),
    signedTransactionBase64: z.string().min(100).max(4096) }).strict(),
  z.object({ action: z.literal("claim"), bridgeId: z.string().regex(ID),
    attemptSequence: z.number().int().min(0), workerId: z.string() }).strict(),
  z.object({ action: z.literal("reconcile"), bridgeId: z.string().regex(ID),
    attemptSequence: z.number().int().min(0), workerId: z.string() }).strict(),
]);

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store, max-age=0", Pragma: "no-cache",
  } });
}

async function sameToken(expected: string, supplied: string): Promise<boolean> {
  const values = await Promise.all([expected, supplied].map((token) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
  const a = new Uint8Array(values[0]);
  const b = new Uint8Array(values[1]);
  let diff = a.length ^ b.length;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

function trustedConfig(): { source: string; destination: string;
  solanaRpcUrl: string; primaryChilizRpcUrl: string;
  secondaryChilizRpcUrl: string } | null {
  const flags = env as unknown as Record<string, unknown>;
  const source = readMainnetConfig().rewardTreasury;
  const destinationRaw = env.CHILIZ_TREASURY_ADDRESS?.trim();
  const heliusKey = env.HELIUS_API_KEY?.trim();
  const primaryChilizRpcUrl = env.CHILIZ_RPC_URL?.trim() ?? "";
  const secondaryChilizRpcUrl = typeof flags.CHILIZ_SECONDARY_RPC_URL === "string" ?
    flags.CHILIZ_SECONDARY_RPC_URL.trim() : "";
  if (!source || !destinationRaw || !heliusKey ||
      !independentChilizRpcOrigins(primaryChilizRpcUrl,
        secondaryChilizRpcUrl)) return null;
  try {
    const publicKey = new PublicKey(source);
    const destination = getAddress(destinationRaw).toLowerCase();
    if (!PublicKey.isOnCurve(publicKey) || publicKey.toBase58() !== source) return null;
    return { source, destination,
      solanaRpcUrl: `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`,
      primaryChilizRpcUrl, secondaryChilizRpcUrl };
  } catch { return null; }
}

/** Private, independently gated repeatable bridge adapter. No public route. */
export async function POST(request: Request): Promise<Response> {
  const flags = env as unknown as Record<string, unknown>;
  if (flags.SPORTPAD_CHILIZ_REPEAT_BRIDGE_API_ENABLED !== "true") {
    return response({ error: "Not found." }, 404);
  }
  const expectedToken = readWorkerToken();
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ") ?
    authorization.slice(7) : "";
  if (!expectedToken || !suppliedToken ||
      !await sameToken(expectedToken, suppliedToken)) {
    return response({ error: "Worker authentication required." }, 401);
  }
  const config = trustedConfig();
  if (!env.DB || !config) {
    return response({ error: "Bridge configuration unavailable." }, 503);
  }
  let input: z.infer<typeof schema>;
  try {
    const body = await request.text();
    if (body.length > 60_000) throw new Error("oversized");
    input = schema.parse(JSON.parse(body));
  } catch { return response({ error: "Invalid worker request." }, 400); }
  if (input.workerId !== `solana:${config.source}`) {
    return response({ error: "Worker identity mismatch." }, 403);
  }
  if (input.action === "inspect") {
    try {
      const bridge = await env.DB.prepare(`SELECT id,source_wallet,destination_treasury,
        source_amount_atomic,minimum_destination_wei,state,source_signature,
        bridge_message_id,destination_tx_hash FROM chiliz_bridge_transfers WHERE id=?1`)
        .bind(input.bridgeId).first<Record<string, unknown>>();
      if (!bridge) return response({ error: "Bridge not found." }, 404);
      if (bridge.source_wallet !== config.source ||
          bridge.destination_treasury !== config.destination) {
        return response({ error: "Bridge identity mismatch." }, 403);
      }
      const attempt = await env.DB.prepare(`SELECT attempt_sequence,state,
        quote_expires_at_ms,source_signature FROM chiliz_bridge_attempts
        WHERE bridge_id=?1 ORDER BY attempt_sequence DESC LIMIT 1`)
        .bind(input.bridgeId).first<Record<string, unknown>>();
      return response({ bridge: {
        id: bridge.id, sourceAmountAtomic: bridge.source_amount_atomic,
        minimumDestinationWei: bridge.minimum_destination_wei,
        state: bridge.state, sourceSignature: bridge.source_signature,
        bridgeMessageId: bridge.bridge_message_id,
        destinationTxHash: bridge.destination_tx_hash,
      }, attempt: attempt ? {
        sequence: attempt.attempt_sequence, state: attempt.state,
        quoteExpiresAtMs: attempt.quote_expires_at_ms,
        sourceSignature: attempt.source_signature,
      } : null }, 200);
    } catch { return response({ error: "Bridge inspection unavailable." }, 503); }
  }
  if (input.action === "prepare") {
    if (flags.SPORTPAD_CHILIZ_REPEAT_BRIDGE_PREPARE_ENABLED !== "true") {
      return response({ error: "Not found." }, 404);
    }
    try {
      const result = await prepareRepeatBridgeAttempt({
        db: env.DB, bridgeId: input.bridgeId,
        attemptSequence: input.attemptSequence,
        plan: input.plan as UnsignedDirectOftChzTransfer,
        signedTransactionBase64: input.signedTransactionBase64,
        expectedSourceWallet: config.source,
        expectedDestinationTreasury: config.destination,
      });
      return response(result, 200);
    } catch { return response({ error: "Bridge attempt rejected." }, 409); }
  }
  if (input.action === "claim") {
    if (flags.SPORTPAD_CHILIZ_REPEAT_BRIDGE_CLAIM_ENABLED !== "true") {
      return response({ error: "Not found." }, 404);
    }
    try {
      const rpc = new Connection(config.solanaRpcUrl, { commitment: "confirmed" });
      const result = await claimRepeatBridgeAttempt({
        db: env.DB, bridgeId: input.bridgeId,
        attemptSequence: input.attemptSequence,
        expectedSourceWallet: config.source,
        expectedDestinationTreasury: config.destination,
        rpc,
      });
      return response(result, 200);
    } catch { return response({ error: "Bridge claim rejected; reconcile by signature." }, 409); }
  }
  try {
    const result = await reconcileRepeatBridgeDelivery({
      db: env.DB, bridgeId: input.bridgeId,
      attemptSequence: input.attemptSequence,
      expectedSourceWallet: config.source,
      expectedDestinationTreasury: config.destination,
      solanaRpcUrl: config.solanaRpcUrl,
      primaryChilizRpcUrl: config.primaryChilizRpcUrl,
      secondaryChilizRpcUrl: config.secondaryChilizRpcUrl,
    });
    return response(result, 200);
  } catch {
    return response({ state: "verification_pending_or_held" }, 409);
  }
}
