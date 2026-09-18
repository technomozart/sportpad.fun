import bs58 from "bs58";

import { normalizeSolanaAddress } from "./wallet-auth.ts";

export const DEVNET_CLUSTER = "solana:devnet" as const;
export const DEVNET_EXPLORER_CLUSTER = "devnet" as const;
export const REWARD_FEE_BPS = 8000;
export const SPORTPAD_FEE_BPS = 2000;

export type UnindexedDevnetTransactionState = "pending" | "failed" | "expired";

export function classifyUnindexedDevnetTransaction({
  signatureStatus,
  blockhashValid,
  invalidityGraceElapsed = false,
}: {
  signatureStatus: { err: unknown } | null;
  blockhashValid: boolean;
  invalidityGraceElapsed?: boolean;
}): UnindexedDevnetTransactionState {
  if (signatureStatus?.err) return "failed";
  // A landed transaction can continue toward finality after the blockhash
  // window. Only a signature the cluster has never seen, whose exact blockhash
  // is no longer valid, can be expired. A caller-reported height never grants
  // permission to replace a recorded attempt.
  if (!signatureStatus && !blockhashValid && invalidityGraceElapsed) return "expired";
  return "pending";
}

export function normalizeTransactionSignature(value: string) {
  const trimmed = value.trim();
  try {
    const bytes = bs58.decode(trimmed);
    if (bytes.length !== 64 || bs58.encode(bytes) !== trimmed) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function validateDevnetRecipients(rewardWallet: string, burnWallet: string, creatorWallet: string) {
  const reward = normalizeSolanaAddress(rewardWallet);
  const burn = normalizeSolanaAddress(burnWallet);
  const creator = normalizeSolanaAddress(creatorWallet);
  if (!reward || !burn || !creator) return { ok: false as const, error: "Enter valid Solana recipient addresses." };
  if (reward === burn) return { ok: false as const, error: "The 80% and 20% recipients must be different wallets." };
  if (reward === creator || burn === creator) {
    return { ok: false as const, error: "Fee recipients must be different from the creator wallet." };
  }
  return { ok: true as const, rewardWallet: reward, burnWallet: burn, creatorWallet: creator };
}
