import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { evaluateSolanaRewardVaultSolvency, SOLANA_REWARD_VAULT_ROWS_SQL,
  type SolanaRewardVaultRow, type SolanaVaultLedgerChange } from "./vault-solvency.ts";

const vaults: SolanaRewardVaultRow[] = [
  { launch_id: "first", owner_address: "treasury", token_account: "shared-ata",
    inventory_atomic: "60", reserved_atomic: "30" },
  { launch_id: "second", owner_address: "treasury", token_account: "shared-ata",
    inventory_atomic: "40", reserved_atomic: "25" },
  { launch_id: "external", owner_address: "other-treasury", token_account: "other-ata",
    inventory_atomic: "1000", reserved_atomic: "1000" },
];

function check(rows = vaults, observedBalanceAtomic = "100",
  change: SolanaVaultLedgerChange = { type: "none" }, requiredLaunchId?: string) {
  return evaluateSolanaRewardVaultSolvency(rows, {
    treasury: "treasury", tokenAccount: "shared-ata", observedBalanceAtomic,
    change, requiredLaunchId,
  });
}

test("sums obligations across launches sharing one reward treasury ATA", () => {
  const result = check(vaults, "100", { type: "none" }, "second");
  assert.equal(result.launchCount, 2);
  assert.equal(result.inventoryAtomic, "100");
  assert.equal(result.reservedAtomic, "55");
  assert.throws(() => check(vaults, "99"), /solana_vault_treasury_insolvent/);
});

test("compares projected on-chain balance after a finalized purchase or claim", () => {
  assert.equal(check(vaults, "115", { type: "purchase_completed", amountAtomic: "15" })
    .projectedInventoryAtomic, "115");
  assert.throws(() => check(vaults, "114", { type: "purchase_completed", amountAtomic: "15" }),
    /solana_vault_treasury_insolvent/);
  assert.equal(check(vaults, "75", { type: "claim_completed", amountAtomic: "25" })
    .projectedReservedAtomic, "30");
  assert.throws(() => check(vaults, "74", { type: "claim_completed", amountAtomic: "25" }),
    /solana_vault_treasury_insolvent/);
});

test("rejects invalid reservations and inconsistent ATA ownership", () => {
  assert.throws(() => check([{ ...vaults[0], reserved_atomic: "61" }]),
    /solana_vault_reserved_exceeds_inventory/);
  assert.throws(() => check([{ ...vaults[0], token_account: "different" }]),
    /solana_vault_token_account_mismatch/);
  assert.throws(() => check([{ ...vaults[2], token_account: "shared-ata" }]),
    /solana_vault_owner_conflict/);
  assert.throws(() => check([{ ...vaults[0], inventory_atomic: "-1" }]),
    /solana_vault_inventory_invalid/);
  assert.throws(() => check(vaults, "100", { type: "none" }, "missing"),
    /solana_vault_launch_missing/);
});

test("the read-only SQL selects all launches for the Solana mint", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE reward_vaults (
        launch_id TEXT, owner_address TEXT, token_account TEXT,
        reward_mint TEXT, chain TEXT, inventory_atomic TEXT, reserved_atomic TEXT
      );
      INSERT INTO reward_vaults VALUES
        ('first', 'treasury', 'shared-ata', 'MINT', 'solana', '60', '30'),
        ('second', 'treasury', 'shared-ata', 'MINT', 'solana', '40', '25'),
        ('external', 'other-treasury', 'other-ata', 'MINT', 'solana', '1000', '1000'),
        ('chiliz', 'evm-treasury', NULL, 'MINT', 'chiliz', '1000', '1000'),
        ('another-mint', 'treasury', 'other-ata', 'OTHER', 'solana', '1000', '1000');
    `);
    const rows = db.prepare(SOLANA_REWARD_VAULT_ROWS_SQL).all("MINT") as SolanaRewardVaultRow[];
    assert.equal(rows.length, 3);
    assert.equal(check(rows).inventoryAtomic, "100");
  } finally { db.close(); }
});
