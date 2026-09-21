import { and, eq, lt } from "drizzle-orm";

import { getDb } from "@/db";
import { walletChallenges } from "@/db/schema";
import {
  buildWalletChallenge,
  normalizeSolanaAddress,
  WALLET_CHALLENGE_TTL_MS,
} from "@/lib/protocol/wallet-auth";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Sign in is required." }, 401);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== url.origin) return privateJson({ error: "Cross-origin wallet requests are not allowed." }, 403);

  let body: { walletAddress?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "Invalid wallet request." }, 400);
  }
  const walletAddress = typeof body.walletAddress === "string"
    ? normalizeSolanaAddress(body.walletAddress)
    : null;
  if (!walletAddress) return privateJson({ error: "Enter a valid Solana wallet address." }, 400);

  const now = Date.now();
  const expiresAt = now + WALLET_CHALLENGE_TTL_MS;
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  let nonce = "";
  for (const byte of nonceBytes) nonce += byte.toString(16).padStart(2, "0");
  const id = crypto.randomUUID();
  const message = buildWalletChallenge({
    domain: url.host,
    uri: url.origin,
    walletAddress,
    nonce,
    issuedAt: new Date(now),
    expiresAt: new Date(expiresAt),
  });

  try {
    const accountLimit = await consumeFixedWindow({ scope: "wallet_challenge_account", subject: ownerUserId, limit: 10, windowSeconds: 600 });
    if (!accountLimit.allowed) return rateLimitedJson("Too many wallet challenges. Try again later.", accountLimit);
    const walletLimit = await consumeFixedWindow({ scope: "wallet_challenge_wallet", subject: walletAddress, limit: 5, windowSeconds: 600 });
    if (!walletLimit.allowed) return rateLimitedJson("This wallet has received too many challenges. Try again later.", walletLimit);
    const db = getDb();
    await db.delete(walletChallenges).where(and(
      eq(walletChallenges.ownerUserId, ownerUserId),
      eq(walletChallenges.walletAddress, walletAddress),
    ));
    await db.delete(walletChallenges).where(lt(walletChallenges.expiresAt, now));
    await db.insert(walletChallenges).values({
      id,
      ownerUserId,
      walletAddress,
      message,
      expiresAt,
      createdAt: now,
    });
    return privateJson({ id, message, walletAddress, expiresAt, chain: "solana:mainnet" }, 201);
  } catch (error) {
    console.error("wallet_challenge_create_failed", error);
    return privateJson({ error: "Wallet verification is temporarily unavailable." }, 503);
  }
}
