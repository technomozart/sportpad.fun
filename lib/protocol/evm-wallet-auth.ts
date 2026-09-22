import { CHILIZ_CHAIN } from "./chiliz-reward-assets.ts";

export const EVM_CHALLENGE_TTL_MS = 10 * 60 * 1_000;

export function buildEvmWalletChallenge({
  origin,
  ownerUserId,
  solanaWallet,
  evmAddress,
  nonce,
  expiresAt,
}: {
  origin: string;
  ownerUserId: string;
  solanaWallet: string;
  evmAddress: string;
  nonce: string;
  expiresAt: number;
}) {
  return [
    "SportPad Chiliz reward wallet verification",
    "",
    `Domain: ${new URL(origin).host}`,
    `Account: ${ownerUserId}`,
    `Verified Solana wallet: ${solanaWallet}`,
    `Chiliz wallet: ${evmAddress}`,
    `Chain ID: ${CHILIZ_CHAIN.id}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    "",
    "Signing links this address for Fan Token claims. It does not authorize spending.",
  ].join("\n");
}
