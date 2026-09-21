import { and, eq, gt } from "drizzle-orm";

import { getDb } from "@/db";
import { walletSessions } from "@/db/schema";
import {
  readCookie,
  sha256Base64Url,
  WALLET_SESSION_TTL_SECONDS,
} from "@/lib/protocol/wallet-auth";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";

// Versioned so sessions created from the previous devnet-bound challenge can
// never authorize a mainnet launch. Users must sign the mainnet-bound message.
export const WALLET_SESSION_COOKIE = "sportpad_mainnet_wallet_session_v1";

function randomBase64Url(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function createWalletSessionToken() {
  return randomBase64Url();
}

export function walletSessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${WALLET_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WALLET_SESSION_TTL_SECONDS}${secure}`;
}

export function clearWalletSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${WALLET_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function getVerifiedWalletSession(request: Request) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return null;
  const token = readCookie(request.headers.get("cookie"), WALLET_SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await sha256Base64Url(token);
  const now = Date.now();
  const [session] = await getDb()
    .select()
    .from(walletSessions)
    .where(and(
      eq(walletSessions.tokenHash, tokenHash),
      eq(walletSessions.ownerUserId, ownerUserId),
      gt(walletSessions.expiresAt, now),
    ))
    .limit(1);
  return session ?? null;
}
