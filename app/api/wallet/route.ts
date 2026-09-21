import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { walletSessions } from "@/db/schema";
import { readCookie, sha256Base64Url } from "@/lib/protocol/wallet-auth";
import {
  clearWalletSessionCookie,
  getVerifiedWalletSession,
  WALLET_SESSION_COOKIE,
} from "@/lib/server/wallet-session";

function privateJson(body: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}

export async function GET(request: Request) {
  try {
    const session = await getVerifiedWalletSession(request);
    if (!session) return privateJson({ wallet: null, chain: "solana:mainnet" });
    return privateJson({
      wallet: session.walletAddress,
      chain: "solana:mainnet",
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error("wallet_session_get_failed", error);
    return privateJson({ error: "Wallet session is temporarily unavailable." }, 503);
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== url.origin) return privateJson({ error: "Cross-origin wallet requests are not allowed." }, 403);
  const token = readCookie(request.headers.get("cookie"), WALLET_SESSION_COOKIE);
  try {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await getDb().delete(walletSessions).where(eq(walletSessions.tokenHash, await sha256Base64Url(token)));
    }
    return privateJson(
      { wallet: null, chain: "solana:mainnet" },
      200,
      { "Set-Cookie": clearWalletSessionCookie(request) },
    );
  } catch (error) {
    console.error("wallet_session_delete_failed", error);
    return privateJson(
      { wallet: null, chain: "solana:mainnet", storageCleanup: "deferred" },
      200,
      { "Set-Cookie": clearWalletSessionCookie(request) },
    );
  }
}
