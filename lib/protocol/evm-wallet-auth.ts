import { CHILIZ_CHAIN } from "./chiliz-reward-assets.ts";

export const EVM_CHALLENGE_TTL_MS = 10 * 60 * 1_000;

// Each signed challenge binds a specific SportPad account and Solana wallet.
// A Chiliz address may be verified for more than one holder wallet, but
// relinking one holder wallet must not replace another holder wallet's link.
export const UPSERT_EVM_WALLET_LINK_SQL = `
  INSERT INTO evm_wallet_links (owner_user_id, solana_wallet, evm_address, chain_id, verified_at, updated_at)
  VALUES (?1, ?2, ?3, 88888, ?4, ?4)
  ON CONFLICT(owner_user_id, solana_wallet) DO UPDATE SET
    evm_address = excluded.evm_address,
    chain_id = excluded.chain_id,
    verified_at = excluded.verified_at,
    updated_at = excluded.updated_at
`;

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
