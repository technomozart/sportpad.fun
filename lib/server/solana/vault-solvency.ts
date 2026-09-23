import { getAssociatedTokenAddressSync, getMint, TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { PublicKey, type Connection } from "@solana/web3.js";

export const SOLANA_REWARD_VAULT_ROWS_SQL = `
  SELECT launch_id, owner_address, token_account, inventory_atomic, reserved_atomic
  FROM reward_vaults WHERE chain = 'solana' AND reward_mint = ?1
`;

export type SolanaRewardVaultRow = {
  launch_id: string; owner_address: string; token_account: string | null;
  inventory_atomic: string; reserved_atomic: string;
};

export type SolanaVaultLedgerChange =
  | { type: "none" }
  | { type: "claim_completed"; amountAtomic: string }
  | { type: "purchase_completed"; amountAtomic: string };

const DECIMAL_ATOMIC = /^(0|[1-9][0-9]*)$/;

function atomic(value: string, code: string) {
  if (!DECIMAL_ATOMIC.test(value)) throw new Error(`solana_vault_${code}`);
  return BigInt(value);
}

/** Evaluate every launch backed by one physical ATA, not one launch at a time.
 * This is a read-only precondition; final D1 compare-and-swap is still required. */
export function evaluateSolanaRewardVaultSolvency(rows: SolanaRewardVaultRow[], input: {
  treasury: string; tokenAccount: string; observedBalanceAtomic: string;
  change: SolanaVaultLedgerChange; requiredLaunchId?: string;
}) {
  const balance = atomic(input.observedBalanceAtomic, "balance_invalid");
  let inventory = 0n;
  let reserved = 0n;
  let includedLaunches = 0;
  let requiredLaunchFound = false;
  for (const row of rows) {
    if (row.owner_address !== input.treasury) {
      if (row.token_account === input.tokenAccount) throw new Error("solana_vault_owner_conflict");
      continue;
    }
    if (row.token_account !== null && row.token_account !== input.tokenAccount) {
      throw new Error("solana_vault_token_account_mismatch");
    }
    const vaultInventory = atomic(row.inventory_atomic, "inventory_invalid");
    const vaultReserved = atomic(row.reserved_atomic, "reserved_invalid");
    if (vaultReserved > vaultInventory) throw new Error("solana_vault_reserved_exceeds_inventory");
    inventory += vaultInventory;
    reserved += vaultReserved;
    includedLaunches += 1;
    if (row.launch_id === input.requiredLaunchId) requiredLaunchFound = true;
  }
  if (input.requiredLaunchId && !requiredLaunchFound) throw new Error("solana_vault_launch_missing");
  const amount = input.change.type === "none" ? 0n : atomic(input.change.amountAtomic, "change_invalid");
  if (input.change.type !== "none" && amount <= 0n) throw new Error("solana_vault_change_invalid");
  const projectedInventory = input.change.type === "purchase_completed" ? inventory + amount
    : input.change.type === "claim_completed" ? inventory - amount : inventory;
  const projectedReserved = input.change.type === "claim_completed" ? reserved - amount : reserved;
  if (projectedInventory < 0n || projectedReserved < 0n ||
    projectedReserved > projectedInventory) throw new Error("solana_vault_projection_invalid");
  if (projectedInventory > balance || projectedReserved > balance) {
    throw new Error("solana_vault_treasury_insolvent");
  }
  return {
    treasury: input.treasury, tokenAccount: input.tokenAccount,
    launchCount: includedLaunches, inventoryAtomic: inventory.toString(),
    reservedAtomic: reserved.toString(), projectedInventoryAtomic: projectedInventory.toString(),
    projectedReservedAtomic: projectedReserved.toString(), observedBalanceAtomic: balance.toString(),
  };
}

/** Finalized-chain balance plus all D1 obligations for the mint/treasury ATA. */
export async function readSolanaRewardVaultSolvency(database: D1Database,
  connection: Connection, input: {
    mint: string; treasury: string; change: SolanaVaultLedgerChange; requiredLaunchId?: string;
  }) {
  const mint = new PublicKey(input.mint);
  const treasury = new PublicKey(input.treasury);
  const mintAccount = await connection.getAccountInfo(mint, "finalized");
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) &&
    !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error("solana_vault_mint_invalid");
  await getMint(connection, mint, "finalized", mintAccount.owner);
  const tokenAccount = getAssociatedTokenAddressSync(mint, treasury, false, mintAccount.owner);
  const [vaults, accountInfo] = await Promise.all([
    database.prepare(SOLANA_REWARD_VAULT_ROWS_SQL).bind(input.mint).all<SolanaRewardVaultRow>(),
    connection.getAccountInfo(tokenAccount, "finalized"),
  ]);
  const unpacked = accountInfo ? unpackAccount(tokenAccount, accountInfo, mintAccount.owner) : null;
  if (unpacked && (!unpacked.mint.equals(mint) || !unpacked.owner.equals(treasury))) {
    throw new Error("solana_vault_ata_identity_mismatch");
  }
  return evaluateSolanaRewardVaultSolvency(vaults.results, {
    treasury: input.treasury, tokenAccount: tokenAccount.toBase58(),
    observedBalanceAtomic: (unpacked?.amount ?? 0n).toString(),
    change: input.change, requiredLaunchId: input.requiredLaunchId,
  });
}
