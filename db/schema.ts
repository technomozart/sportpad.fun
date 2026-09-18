import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const launchDrafts = sqliteTable(
  "launch_drafts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    rewardSymbol: text("reward_symbol").notNull(),
    rewardMint: text("reward_mint"),
    rewardBps: integer("reward_bps").notNull().default(8000),
    buybackBps: integer("buyback_bps").notNull().default(2000),
    status: text("status").notNull().default("draft"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_launch_drafts_owner_created").on(table.ownerUserId, table.createdAt),
    index("idx_launch_drafts_status").on(table.status),
  ],
);

export const feeEvents = sqliteTable(
  "fee_events",
  {
    id: text("id").primaryKey(),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    sourceSignature: text("source_signature").notNull(),
    sourceSlot: integer("source_slot").notNull(),
    grossAmountAtomic: text("gross_amount_atomic").notNull(),
    state: text("state").notNull().default("observed"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_fee_events_source_signature").on(table.sourceSignature),
    index("idx_fee_events_launch_state").on(table.launchId, table.state),
  ],
);

export const settlements = sqliteTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    feeEventId: text("fee_event_id").notNull().references(() => feeEvents.id),
    rewardAmountAtomic: text("reward_amount_atomic").notNull(),
    buybackAmountAtomic: text("buyback_amount_atomic").notNull(),
    rewardSwapSignature: text("reward_swap_signature"),
    buybackSwapSignature: text("buyback_swap_signature"),
    burnSignature: text("burn_signature"),
    state: text("state").notNull().default("distributed"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_settlements_fee_event").on(table.feeEventId),
    index("idx_settlements_state").on(table.state),
  ],
);

export const rewardEpochs = sqliteTable(
  "reward_epochs",
  {
    id: text("id").primaryKey(),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    cutoffSlot: integer("cutoff_slot"),
    fundedAmountAtomic: text("funded_amount_atomic").notNull().default("0"),
    merkleRoot: text("merkle_root"),
    allocationHash: text("allocation_hash"),
    state: text("state").notNull().default("accruing"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_reward_epochs_launch_state").on(table.launchId, table.state)],
);

export const rewardClaims = sqliteTable(
  "reward_claims",
  {
    id: text("id").primaryKey(),
    epochId: text("epoch_id").notNull().references(() => rewardEpochs.id),
    solanaWallet: text("solana_wallet").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    claimSignature: text("claim_signature"),
    state: text("state").notNull().default("claimable"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_reward_claims_epoch_wallet").on(table.epochId, table.solanaWallet),
    index("idx_reward_claims_wallet_state").on(table.solanaWallet, table.state),
  ],
);

export const serviceCursors = sqliteTable("service_cursors", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
