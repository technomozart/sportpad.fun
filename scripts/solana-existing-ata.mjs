import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";

// An automation job must never create an ATA as an unrecorded treasury-funded
// transaction. Provision it separately, then require finalized proof here.
export async function requireExistingTreasuryAta({
  connection, mint, owner, tokenProgram, readAccount = getAccount,
}) {
  const address = await getAssociatedTokenAddress(mint, owner, false, tokenProgram);
  let account;
  try {
    account = await readAccount(connection, address, "finalized", tokenProgram);
  } catch (error) {
    throw new Error("treasury_output_ata_not_ready", { cause: error });
  }
  if (account?.address?.equals?.(address) !== true ||
    account?.owner?.equals?.(owner) !== true ||
    account?.mint?.equals?.(mint) !== true ||
    account?.isInitialized !== true || account?.isFrozen !== false ||
    account?.delegate !== null || account?.closeAuthority !== null) {
    throw new Error("treasury_output_ata_mismatch");
  }
  return account;
}
