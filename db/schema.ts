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
    devnetPublishedAt: text("devnet_published_at"),
    mainnetCreatorWallet: text("mainnet_creator_wallet"),
    mainnetMetadataUri: text("mainnet_metadata_uri"),
    mainnetMint: text("mainnet_mint"),
    mainnetCreateSignature: text("mainnet_create_signature"),
    mainnetFeeSignature: text("mainnet_fee_signature"),
    mainnetCreateSlot: integer("mainnet_create_slot"),
    mainnetFeeSlot: integer("mainnet_fee_slot"),
    mainnetRewardTreasury: text("mainnet_reward_treasury"),
    mainnetBuybackTreasury: text("mainnet_buyback_treasury"),
    mainnetVerifiedAt: text("mainnet_verified_at"),
    moderationVersion: integer("moderation_version").notNull().default(0),
    moderationSubmittedAt: text("moderation_submitted_at"),
    moderationReviewedAt: text("moderation_reviewed_at"),
    moderationActorUserId: text("moderation_actor_user_id"),
    moderationActorRole: text("moderation_actor_role"),
    moderationAction: text("moderation_action"),
    moderationReason: text("moderation_reason"),
    moderationOwnerMessage: text("moderation_owner_message"),
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
    uniqueIndex("idx_launch_drafts_mainnet_mint").on(table.mainnetMint),
    uniqueIndex("idx_launch_drafts_mainnet_create_signature").on(table.mainnetCreateSignature),
    uniqueIndex("idx_launch_drafts_mainnet_fee_signature").on(table.mainnetFeeSignature),
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

export const protocolControls = sqliteTable("protocol_controls", {
  key: text("key").primaryKey(),
  settlementPaused: integer("settlement_paused", { mode: "boolean" }).notNull().default(true),
  rewardsPaused: integer("rewards_paused", { mode: "boolean" }).notNull().default(true),
  buybackPaused: integer("buyback_paused", { mode: "boolean" }).notNull().default(true),
  pauseReason: text("pause_reason").notNull().default("signer_not_configured"),
  revision: integer("revision").notNull().default(0),
  updatedByUserId: text("updated_by_user_id"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workerRuns = sqliteTable(
  "worker_runs",
  {
    id: text("id").primaryKey(),
    worker: text("worker").notNull(),
    trigger: text("trigger").notNull(),
    state: text("state").notNull().default("running"),
    itemsSeen: integer("items_seen").notNull().default(0),
    itemsChanged: integer("items_changed").notNull().default(0),
    cursorBefore: text("cursor_before"),
    cursorAfter: text("cursor_after"),
    errorCode: text("error_code"),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_worker_runs_worker_started").on(table.worker, table.startedAt),
    index("idx_worker_runs_state_started").on(table.state, table.startedAt),
  ],
);

export const workerLeases = sqliteTable("worker_leases", {
  key: text("key").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: integer("expires_at").notNull(),
  acquiredAt: integer("acquired_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const settlementSteps = sqliteTable(
  "settlement_steps",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id").notNull().references(() => settlements.id),
    stage: text("stage").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").notNull().default("planned"),
    inputMint: text("input_mint"),
    outputMint: text("output_mint"),
    inputAmountAtomic: text("input_amount_atomic"),
    outputAmountAtomic: text("output_amount_atomic"),
    minimumOutputAtomic: text("minimum_output_atomic"),
    providerRequestId: text("provider_request_id"),
    txSignature: text("tx_signature"),
    verifiedSlot: integer("verified_slot"),
    attempt: integer("attempt").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_settlement_steps_idempotency").on(table.idempotencyKey),
    uniqueIndex("idx_settlement_steps_signature").on(table.txSignature),
    index("idx_settlement_steps_settlement_stage").on(table.settlementId, table.stage),
    index("idx_settlement_steps_state").on(table.state),
  ],
);

export const rewardVaults = sqliteTable(
  "reward_vaults",
  {
    id: text("id").primaryKey(),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    rewardMint: text("reward_mint").notNull(),
    ownerAddress: text("owner_address").notNull(),
    tokenAccount: text("token_account"),
    state: text("state").notNull().default("observed"),
    inventoryAtomic: text("inventory_atomic").notNull().default("0"),
    reservedAtomic: text("reserved_atomic").notNull().default("0"),
    allocatedAtomic: text("allocated_atomic").notNull().default("0"),
    claimedAtomic: text("claimed_atomic").notNull().default("0"),
    lastObservedSlot: integer("last_observed_slot"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_reward_vaults_launch_mint").on(table.launchId, table.rewardMint),
    index("idx_reward_vaults_state").on(table.state),
  ],
);

export const holderEpochPositions = sqliteTable(
  "holder_epoch_positions",
  {
    id: text("id").primaryKey(),
    epochId: text("epoch_id").notNull().references(() => rewardEpochs.id),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    wallet: text("wallet").notNull(),
    tokenSecondsAtomic: text("token_seconds_atomic").notNull().default("0"),
    endingBalanceAtomic: text("ending_balance_atomic").notNull().default("0"),
    lastObservedSlot: integer("last_observed_slot"),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    exclusionReason: text("exclusion_reason"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_holder_positions_epoch_wallet").on(table.epochId, table.wallet),
    index("idx_holder_positions_launch_wallet").on(table.launchId, table.wallet),
  ],
);

export const protocolEvents = sqliteTable(
  "protocol_events",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").notNull(),
    signature: text("signature"),
    slot: integer("slot"),
    amountAtomic: text("amount_atomic"),
    mint: text("mint"),
    evidenceHash: text("evidence_hash"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_protocol_events_idempotency").on(table.idempotencyKey),
    index("idx_protocol_events_category_created").on(table.category, table.createdAt),
    index("idx_protocol_events_entity").on(table.entityType, table.entityId),
  ],
);

export const treasuryObservations = sqliteTable(
  "treasury_observations",
  {
    id: text("id").primaryKey(),
    purpose: text("purpose").notNull(),
    address: text("address").notNull(),
    balanceLamports: text("balance_lamports").notNull(),
    slot: integer("slot").notNull(),
    observedAt: text("observed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_treasury_observations_purpose_slot").on(table.purpose, table.slot),
    index("idx_treasury_observations_observed").on(table.observedAt),
  ],
);

export const launchModerationEvents = sqliteTable(
  "launch_moderation_events",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id").notNull().references(() => launchDrafts.id),
    actorUserId: text("actor_user_id").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    reasonCode: text("reason_code"),
    ownerMessage: text("owner_message"),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_launch_moderation_draft_version").on(table.draftId, table.version),
    index("idx_launch_moderation_state_created").on(table.toState, table.createdAt),
  ],
);

export const rateLimitWindows = sqliteTable(
  "rate_limit_windows",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowExpiresAt: integer("window_expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_rate_limit_windows_expires").on(table.windowExpiresAt)],
);
