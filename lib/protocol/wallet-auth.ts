import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";

export const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const WALLET_SESSION_TTL_SECONDS = 24 * 60 * 60;

export type WalletChallengeFields = {
  domain: string;
  uri: string;
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
};

export function normalizeSolanaAddress(value: string) {
  const trimmed = value.trim();
  try {
    const bytes = bs58.decode(trimmed);
    if (bytes.length !== 32 || bs58.encode(bytes) !== trimmed) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function buildWalletChallenge(fields: WalletChallengeFields) {
  return [
    `${fields.domain} wants you to verify this Solana wallet for SportPad.`,
    "",
    `Wallet: ${fields.walletAddress}`,
    `URI: ${fields.uri}`,
    "Version: 1",
    "Chain: solana:devnet",
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt.toISOString()}`,
    `Expiration Time: ${fields.expiresAt.toISOString()}`,
    "Purpose: Bind this wallet to your SportPad account for devnet launch testing.",
    "This request does not create a transaction or authorize spending.",
  ].join("\n");
}

function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 128) return null;
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function verifyWalletChallengeSignature({
  walletAddress,
  message,
  signatureBase64,
}: {
  walletAddress: string;
  message: string;
  signatureBase64: string;
}) {
  const normalized = normalizeSolanaAddress(walletAddress);
  const signature = decodeBase64(signatureBase64);
  if (!normalized || !signature || signature.length !== 64) return false;
  try {
    return ed25519.verify(
      Uint8Array.from(signature),
      new TextEncoder().encode(message),
      Uint8Array.from(bs58.decode(normalized)),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

export function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
