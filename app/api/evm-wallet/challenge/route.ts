import { env } from "cloudflare:workers";
import { getAddress } from "viem";

import { buildEvmWalletChallenge, EVM_CHALLENGE_TTL_MS } from "@/lib/protocol/evm-wallet-auth";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";
import { getVerifiedWalletSession } from "@/lib/server/wallet-session";

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Wallet storage is unavailable." }, { status: 503 });
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return Response.json({ error: "Cross-origin wallet requests are not allowed." }, { status: 403 });
  const session = await getVerifiedWalletSession(request);
  if (!session) return Response.json({ error: "Verify your Solana wallet first." }, { status: 401 });
  let untrustedAddress = "";
  try { untrustedAddress = String((await request.json() as { address?: unknown }).address ?? ""); }
  catch { return Response.json({ error: "Invalid wallet request." }, { status: 400 }); }
  let evmAddress: `0x${string}`;
  try { evmAddress = getAddress(untrustedAddress); }
  catch { return Response.json({ error: "Enter a valid EVM wallet address." }, { status: 400 }); }
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + EVM_CHALLENGE_TTL_MS;
  const message = buildEvmWalletChallenge({
    origin,
    ownerUserId: session.ownerUserId,
    solanaWallet: session.walletAddress,
    evmAddress,
    nonce: id,
    expiresAt,
  });
  try {
    const accountLimit = await consumeFixedWindow({ scope: "evm_wallet_challenge_account", subject: session.ownerUserId, limit: 10, windowSeconds: 600 });
    if (!accountLimit.allowed) return rateLimitedJson("Too many Chiliz wallet challenges. Try again later.", accountLimit);
    const addressLimit = await consumeFixedWindow({ scope: "evm_wallet_challenge_address", subject: evmAddress.toLowerCase(), limit: 5, windowSeconds: 600 });
    if (!addressLimit.allowed) return rateLimitedJson("This Chiliz wallet has received too many challenges. Try again later.", addressLimit);
    await env.DB.prepare("DELETE FROM evm_wallet_challenges WHERE expires_at < ?1")
      .bind(createdAt).run();
    await env.DB.prepare(`
      INSERT INTO evm_wallet_challenges
        (id, owner_user_id, solana_wallet, evm_address, message, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind(id, session.ownerUserId, session.walletAddress, evmAddress, message, expiresAt, createdAt).run();
  } catch (error) {
    console.error("evm_wallet_challenge_create_failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Chiliz wallet verification is temporarily unavailable." }, { status: 503 });
  }
  return Response.json({ challengeId: id, address: evmAddress, message, expiresAt }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
