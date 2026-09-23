import { env } from "cloudflare:workers";
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

import { isOperatorRequest } from "@/lib/server/publication-policy";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { getMainnetConnection } from "@/lib/server/solana/devnet";

const inputSchema = z.object({ sportpadMint: z.string().min(32).max(44) }).strict();

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!isOperatorRequest(request)) return json({ error: "Not found." }, 404);
  if (!env.DB) return json({ error: "Settings storage is unavailable." }, 503);
  const row = await env.DB.prepare("SELECT value, updated_at FROM protocol_settings WHERE key = 'sportpad_mint'")
    .first<{ value: string; updated_at: string }>();
  return json({ sportpadMint: row?.value ?? null, updatedAt: row?.updated_at ?? null });
}

export async function POST(request: Request) {
  if (!isOperatorRequest(request)) return json({ error: "Not found." }, 404);
  if (!env.DB) return json({ error: "Settings storage is unavailable." }, 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Cross-origin settings requests are not allowed." }, 403);
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(await request.json()); }
  catch { return json({ error: "Enter a valid Solana mint address." }, 400); }
  let mint: string;
  try { mint = new PublicKey(input.sportpadMint).toBase58(); }
  catch { return json({ error: "Enter a valid Solana mint address." }, 400); }
  const configuredMint = readMainnetConfig().sportpadMint;
  if (configuredMint && configuredMint !== mint) {
    return json({ error: "This address conflicts with the configured SPORTPAD mint." }, 409);
  }
  try {
    const connection = getMainnetConnection();
    const mintAddress = new PublicKey(mint);
    const account = await connection.getAccountInfo(mintAddress, "finalized");
    if (!account || (!account.owner.equals(TOKEN_PROGRAM_ID) &&
      !account.owner.equals(TOKEN_2022_PROGRAM_ID))) {
      return json({ error: "This address is not a finalized Solana token mint." }, 409);
    }
    await getMint(connection, mintAddress, "finalized", account.owner);
  } catch {
    return json({ error: "Could not verify this mint on Solana mainnet. Try again when the chain is available." }, 503);
  }
  const actor = getLaunchDraftOwner(request)!;
  await env.DB.prepare(`
    INSERT INTO protocol_settings (key, value, updated_by_user_id, updated_at)
    VALUES ('sportpad_mint', ?1, ?2, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO NOTHING
  `).bind(mint, actor).run();
  const registered = await env.DB.prepare(
    "SELECT value FROM protocol_settings WHERE key = 'sportpad_mint'",
  ).first<{ value: string }>();
  if (registered?.value !== mint) {
    return json({ error: "A different SPORTPAD mint is already registered. Registration cannot be silently changed." }, 409);
  }
  return json({ sportpadMint: mint, registered: true, buybackReady: false });
}
