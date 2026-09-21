import { and, eq, gt, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { walletChallenges, walletSessions } from "@/db/schema";
import {
  normalizeSolanaAddress,
  sha256Base64Url,
  verifyWalletChallengeSignature,
  WALLET_SESSION_TTL_SECONDS,
} from "@/lib/protocol/wallet-auth";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { createWalletSessionToken, walletSessionCookie } from "@/lib/server/wallet-session";

function privateJson(body: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}

export async function POST(request: Request) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Sign in is required." }, 401);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== url.origin) return privateJson({ error: "Cross-origin wallet requests are not allowed." }, 403);

  let body: { id?: unknown; walletAddress?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "Invalid wallet verification request." }, 400);
  }
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
  const walletAddress = typeof body.walletAddress === "string"
    ? normalizeSolanaAddress(body.walletAddress)
    : null;
  const signature = typeof body.signature === "string" ? body.signature : null;
  if (!id || !walletAddress || !signature) {
    return privateJson({ error: "Wallet verification data is incomplete." }, 400);
  }

  const now = Date.now();
  try {
    const db = getDb();
    const [challenge] = await db.select().from(walletChallenges).where(and(
      eq(walletChallenges.id, id),
      eq(walletChallenges.ownerUserId, ownerUserId),
      eq(walletChallenges.walletAddress, walletAddress),
      isNull(walletChallenges.usedAt),
      gt(walletChallenges.expiresAt, now),
    )).limit(1);
    if (!challenge) return privateJson({ error: "That wallet request expired or was already used." }, 409);
    if (!await verifyWalletChallengeSignature({ walletAddress, message: challenge.message, signatureBase64: signature })) {
      return privateJson({ error: "The wallet signature could not be verified." }, 401);
    }

    const consumed = await db.update(walletChallenges)
      .set({ usedAt: now })
      .where(and(
        eq(walletChallenges.id, id),
        isNull(walletChallenges.usedAt),
        gt(walletChallenges.expiresAt, now),
      ))
      .returning({ id: walletChallenges.id });
    if (consumed.length !== 1) return privateJson({ error: "That wallet request was already used." }, 409);

    const token = createWalletSessionToken();
    const tokenHash = await sha256Base64Url(token);
    const expiresAt = now + WALLET_SESSION_TTL_SECONDS * 1000;
    await db.delete(walletSessions).where(and(
      eq(walletSessions.ownerUserId, ownerUserId),
      eq(walletSessions.walletAddress, walletAddress),
    ));
    await db.insert(walletSessions).values({
      tokenHash,
      ownerUserId,
      walletAddress,
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
    });
    return privateJson(
      { walletAddress, chain: "solana:mainnet", expiresAt },
      200,
      { "Set-Cookie": walletSessionCookie(token, request) },
    );
  } catch (error) {
    console.error("wallet_verification_failed", error);
    return privateJson({ error: "Wallet verification is temporarily unavailable." }, 503);
  }
}
