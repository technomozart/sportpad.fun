import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const launchDrafts = sqliteTable(
  "launch_drafts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    description: text("description").notNull().default(""),
    sport: text("sport").notNull().default("Football"),
    website: text("website"),
    social: text("social"),
    imageKey: text("image_key"),
    imageMime: text("image_mime"),
    imageSize: integer("image_size"),
    creatorWallet: text("creator_wallet"),
    devnetMetadataUri: text("devnet_metadata_uri"),
    devnetMint: text("devnet_mint"),
    devnetCreateSignature: text("devnet_create_signature"),
    devnetFeeSignature: text("devnet_fee_signature"),
    devnetRewardWallet: text("devnet_reward_wallet"),
    devnetBurnWallet: text("devnet_burn_wallet"),
    devnetVerifiedAt: text("devnet_verified_at"),
    rightsAttested: integer("rights_attested", { mode: "boolean" }).notNull().default(false),
    unofficialAttested: integer("unofficial_attested", { mode: "boolean" }).notNull().default(false),
    economicsAttested: integer("economics_attested", { mode: "boolean" }).notNull().default(false),
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
    uniqueIndex("idx_launch_drafts_devnet_mint").on(table.devnetMint),
    uniqueIndex("idx_launch_drafts_devnet_create_signature").on(table.devnetCreateSignature),
    uniqueIndex("idx_launch_drafts_devnet_fee_signature").on(table.devnetFeeSignature),
  ],
);

export const walletChallenges = sqliteTable(
  "wallet_challenges",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    message: text("message").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_wallet_challenges_owner_wallet").on(table.ownerUserId, table.walletAddress),
    index("idx_wallet_challenges_expires").on(table.expiresAt),
  ],
);

export const walletSessions = sqliteTable(
  "wallet_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull(),
  },
  (table) => [
    index("idx_wallet_sessions_owner_wallet").on(table.ownerUserId, table.walletAddress),
    index("idx_wallet_sessions_expires").on(table.expiresAt),
  ],
);

export const devnetSubmissions = sqliteTable(
  "devnet_submissions",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id").notNull().references(() => launchDrafts.id),
    ownerUserId: text("owner_user_id").notNull(),
    kind: text("kind").notNull(),
    mint: text("mint").notNull(),
    creatorWallet: text("creator_wallet").notNull().default(""),
    metadataUri: text("metadata_uri").notNull().default(""),
    rewardWallet: text("reward_wallet").notNull().default(""),
    burnWallet: text("burn_wallet").notNull().default(""),
    tokenName: text("token_name").notNull().default(""),
    tokenSymbol: text("token_symbol").notNull().default(""),
    signature: text("signature").notNull(),
    blockhash: text("blockhash").notNull(),
    lastValidBlockHeight: integer("last_valid_block_height").notNull(),
    status: text("status").notNull().default("recorded"),
    verifiedSlot: integer("verified_slot"),
    invalidBlockhashObservedAt: integer("invalid_blockhash_observed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_devnet_submissions_draft_kind").on(table.draftId, table.kind),
    uniqueIndex("idx_devnet_submissions_signature").on(table.signature),
    uniqueIndex("idx_devnet_submissions_mint_kind").on(table.mint, table.kind),
    index("idx_devnet_submissions_owner_status").on(table.ownerUserId, table.status),
  ],
);

export const feeEvents = sqliteTable(
  "fee_events",
  {
    id: text("id").primaryKey(),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    sourceSignature: text("source_signature").notNull(),
    instructionIndex: integer("instruction_index").notNull().default(0),
    sourceSlot: integer("source_slot").notNull(),
    grossAmountAtomic: text("gross_amount_atomic").notNull(),
    state: text("state").notNull().default("observed"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_fee_events_source_instruction").on(table.sourceSignature, table.instructionIndex),
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
