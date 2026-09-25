import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    rewardChain: text("reward_chain").notNull().default("solana"),
    rewardMint: text("reward_mint"),
    rewardWrappedContract: text("reward_wrapped_contract"),
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

export const evmWalletChallenges = sqliteTable(
  "evm_wallet_challenges",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    solanaWallet: text("solana_wallet").notNull(),
    evmAddress: text("evm_address").notNull(),
    message: text("message").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_evm_challenges_owner_address").on(table.ownerUserId, table.evmAddress),
    index("idx_evm_challenges_expires").on(table.expiresAt),
  ],
);

export const evmWalletLinks = sqliteTable(
  "evm_wallet_links",
  {
    ownerUserId: text("owner_user_id").notNull(),
    solanaWallet: text("solana_wallet").notNull(),
    evmAddress: text("evm_address").notNull(),
    chainId: integer("chain_id").notNull().default(88888),
    verifiedAt: integer("verified_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUserId, table.solanaWallet] }),
    index("idx_evm_links_address").on(table.evmAddress),
    index("idx_evm_links_solana_wallet").on(table.solanaWallet),
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
    // Progress of verified automatic Solana reward chunks only. The reward
    // leg is complete once this equals rewardAmountAtomic.
    rewardSpentAtomic: text("reward_spent_atomic").notNull().default("0"),
    buybackAmountAtomic: text("buyback_amount_atomic").notNull(),
    buybackSpentAtomic: text("buyback_spent_atomic").notNull().default("0"),
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
    // One finalized Solana reward purchase may aggregate fee shares from
    // several settlements. The batch/source ledger proves each attribution.
    index("idx_settlements_reward_swap_signature").on(table.rewardSwapSignature),
    uniqueIndex("idx_settlements_buyback_swap_signature").on(table.buybackSwapSignature)
      .where(sql`${table.buybackSwapSignature} IS NOT NULL`),
    index("idx_settlements_state").on(table.state),
  ],
);

/** One immutable reservation of a finalized Pump fee event's complete 80%
 * SOL reward share for Chiliz funding. This is accounting only: a reservation
 * never authorizes a Jupiter order, bridge transaction, or treasury spend. */
export const chilizFeeReservations = sqliteTable(
  "chiliz_fee_reservations",
  {
    id: text("id").primaryKey(),
    feeEventId: text("fee_event_id").notNull().references(() => feeEvents.id),
    settlementId: text("settlement_id").notNull().references(() => settlements.id),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    rewardTreasury: text("reward_treasury").notNull(),
    sourceSignature: text("source_signature").notNull(),
    sourceSlot: integer("source_slot").notNull(),
    grossAmountLamports: text("gross_amount_lamports").notNull(),
    rewardAmountLamports: text("reward_amount_lamports").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_chiliz_fee_reservation_event").on(table.feeEventId),
    uniqueIndex("idx_chiliz_fee_reservation_settlement").on(table.settlementId),
    index("idx_chiliz_fee_reservation_launch").on(table.launchId),
    check("chk_chiliz_fee_reservation_source_slot", sql`${table.sourceSlot} > 0`),
    check("chk_chiliz_fee_reservation_source_signature", sql`length(${table.sourceSignature}) BETWEEN 64 AND 88`),
    check("chk_chiliz_fee_reservation_gross", sql`${table.grossAmountLamports} GLOB '[1-9]*' AND ${table.grossAmountLamports} NOT GLOB '*[^0-9]*' AND length(${table.grossAmountLamports}) <= 16`),
    check("chk_chiliz_fee_reservation_reward", sql`${table.rewardAmountLamports} GLOB '[1-9]*' AND ${table.rewardAmountLamports} NOT GLOB '*[^0-9]*' AND length(${table.rewardAmountLamports}) <= 16`),
  ],
);

/** Sequential capped signed SOL -> official Solana CHZ orders for a reserved
 * fee share. This journal records intents and independently checked finality;
 * it does not authorize signing or network broadcast. */
export const chilizSolChzSwapJournal = sqliteTable(
  "chiliz_sol_chz_swap_journal",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id").notNull().references(() => chilizFeeReservations.id),
    chunkSequence: integer("chunk_sequence").notNull(),
    attemptSequence: integer("attempt_sequence").notNull(),
    chunkOffsetLamports: text("chunk_offset_lamports").notNull(),
    sourceWallet: text("source_wallet").notNull(),
    inputMint: text("input_mint").notNull(),
    outputMint: text("output_mint").notNull(),
    outputTokenProgram: text("output_token_program").notNull(),
    outputAta: text("output_ata").notNull(),
    inputAmountLamports: text("input_amount_lamports").notNull(),
    minimumOutputAtomic: text("minimum_output_atomic").notNull(),
    providerRequestId: text("provider_request_id").notNull(),
    lastValidBlockHeight: integer("last_valid_block_height").notNull(),
    unsignedTransactionBase64: text("unsigned_transaction_base64").notNull(),
    signedTransactionBase64: text("signed_transaction_base64").notNull(),
    signedTransactionSha256: text("signed_transaction_sha256").notNull(),
    transactionMessageHash: text("transaction_message_hash").notNull(),
    sourceSignature: text("source_signature").notNull(),
    state: text("state").notNull().default("prepared"),
    broadcastAttemptedAtMs: integer("broadcast_attempted_at_ms"),
    expiryFinalizedBlockHeight: integer("expiry_finalized_block_height"),
    finalizedSlot: integer("finalized_slot"),
    sourceBalanceBeforeLamports: text("source_balance_before_lamports"),
    sourceBalanceAfterLamports: text("source_balance_after_lamports"),
    outputBalanceBeforeAtomic: text("output_balance_before_atomic"),
    outputBalanceAfterAtomic: text("output_balance_after_atomic"),
    outputAmountAtomic: text("output_amount_atomic"),
    receiptErrorCode: text("receipt_error_code"),
    receiptEvidenceJson: text("receipt_evidence_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_chiliz_sol_chz_swap_reservation_attempt").on(table.reservationId, table.chunkSequence, table.attemptSequence),
    uniqueIndex("idx_chiliz_sol_chz_swap_successful_chunk").on(table.reservationId, table.chunkSequence).where(sql`${table.state} = 'finalized_success'`),
    uniqueIndex("idx_chiliz_sol_chz_swap_request").on(table.providerRequestId),
    uniqueIndex("idx_chiliz_sol_chz_swap_signature").on(table.sourceSignature),
    uniqueIndex("idx_chiliz_sol_chz_swap_signed_sha256").on(table.signedTransactionSha256),
    index("idx_chiliz_sol_chz_swap_state").on(table.state),
    check("chk_chiliz_sol_chz_swap_input_mint", sql`${table.inputMint} = 'So11111111111111111111111111111111111111112'`),
    check("chk_chiliz_sol_chz_swap_output_mint", sql`${table.outputMint} = '6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw'`),
    check("chk_chiliz_sol_chz_swap_state", sql`${table.state} IN ('prepared', 'expired_unbroadcast', 'broadcast_unknown', 'finalized_success', 'finalized_failure')`),
    check("chk_chiliz_sol_chz_swap_input", sql`${table.inputAmountLamports} GLOB '[1-9]*' AND ${table.inputAmountLamports} NOT GLOB '*[^0-9]*' AND (length(${table.inputAmountLamports}) < 9 OR (length(${table.inputAmountLamports}) = 9 AND ${table.inputAmountLamports} <= '100000000'))`),
    check("chk_chiliz_sol_chz_swap_minimum", sql`${table.minimumOutputAtomic} GLOB '[1-9]*' AND ${table.minimumOutputAtomic} NOT GLOB '*[^0-9]*' AND length(${table.minimumOutputAtomic}) <= 18`),
    check("chk_chiliz_sol_chz_swap_block_height", sql`${table.lastValidBlockHeight} > 0`),
    check("chk_chiliz_sol_chz_swap_sha256", sql`length(${table.signedTransactionSha256}) = 64 AND ${table.signedTransactionSha256} NOT GLOB '*[^0-9a-f]*' AND length(${table.transactionMessageHash}) = 64 AND ${table.transactionMessageHash} NOT GLOB '*[^0-9a-f]*'`),
    check("chk_chiliz_sol_chz_swap_signature", sql`length(${table.sourceSignature}) BETWEEN 64 AND 88`),
    check("chk_chiliz_sol_chz_swap_sequence", sql`${table.chunkSequence} BETWEEN 0 AND 9999999 AND ${table.attemptSequence} BETWEEN 0 AND 2`),
    check("chk_chiliz_sol_chz_swap_offset", sql`${table.chunkOffsetLamports} GLOB '[0-9]*' AND ${table.chunkOffsetLamports} NOT GLOB '*[^0-9]*' AND (${table.chunkOffsetLamports} = '0' OR substr(${table.chunkOffsetLamports},1,1) <> '0') AND length(${table.chunkOffsetLamports}) <= 16`),
  ],
);

/** An open batch keeps small fee shares together until Jupiter offers an
 * executable order. It is immutable once a worker leases the queued job. */
export const rewardSwapBatches = sqliteTable(
  "reward_swap_batches",
  {
    id: text("id").primaryKey(),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    rewardMint: text("reward_mint").notNull(),
    treasury: text("treasury").notNull(),
    inputAmountAtomic: text("input_amount_atomic").notNull().default("0"),
    state: text("state").notNull().default("collecting"),
    txSignature: text("tx_signature"),
    outputAmountAtomic: text("output_amount_atomic"),
    verifiedSlot: integer("verified_slot"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_reward_swap_batches_open_launch").on(table.launchId)
      .where(sql`${table.state} IN ('collecting', 'queued')`),
    uniqueIndex("idx_reward_swap_batches_signature").on(table.txSignature)
      .where(sql`${table.txSignature} IS NOT NULL`),
    index("idx_reward_swap_batches_state_created").on(table.state, table.createdAt),
  ],
);

/** Exact immutable contribution from one fee settlement to one purchase.
 * A source cannot be reserved in another batch until the prior buy settles. */
export const rewardSwapBatchSources = sqliteTable(
  "reward_swap_batch_sources",
  {
    batchId: text("batch_id").notNull().references(() => rewardSwapBatches.id),
    settlementId: text("settlement_id").notNull().references(() => settlements.id),
    offsetAtomic: text("offset_atomic").notNull(),
    inputAmountAtomic: text("input_amount_atomic").notNull(),
    totalAtomic: text("total_atomic").notNull(),
    state: text("state").notNull().default("reserved"),
    verifiedSignature: text("verified_signature"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.settlementId, table.offsetAtomic] }),
    uniqueIndex("idx_reward_swap_sources_settlement_offset")
      .on(table.settlementId, table.offsetAtomic),
    uniqueIndex("idx_reward_swap_sources_active_settlement")
      .on(table.settlementId).where(sql`${table.state} = 'reserved'`),
    index("idx_reward_swap_sources_batch_state").on(table.batchId, table.state),
  ],
);

/** A single, operator-armed mainnet purchase canary. This does not enable
 * public launches, claims, or any other financial action. Its one immutable
 * batch reservation is counted before a signed purchase intent is stored. */
export const solanaRewardPurchaseCanary = sqliteTable(
  "solana_reward_purchase_canary",
  {
    key: text("key").primaryKey(),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    settlementId: text("settlement_id").notNull().references(() => settlements.id),
    maxInputLamports: integer("max_input_lamports").notNull(),
    reservedInputLamports: integer("reserved_input_lamports").notNull().default(0),
    rewardBatchId: text("reward_batch_id").references(() => rewardSwapBatches.id),
    state: text("state").notNull().default("paused"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("chk_solana_reward_canary_singleton", sql`${table.key} = 'initial'`),
    check("chk_solana_reward_canary_cap", sql`${table.maxInputLamports} BETWEEN 1000000 AND 100000000`),
    check("chk_solana_reward_canary_spend", sql`${table.reservedInputLamports} BETWEEN 0 AND ${table.maxInputLamports}`),
    check("chk_solana_reward_canary_batch_reservation", sql`(${table.rewardBatchId} IS NULL AND ${table.reservedInputLamports} = 0) OR (${table.rewardBatchId} IS NOT NULL AND ${table.reservedInputLamports} > 0)`),
    check("chk_solana_reward_canary_state", sql`${table.state} IN ('paused', 'armed')`),
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
    allocatedAmountAtomic: text("allocated_amount_atomic").notNull().default("0"),
    dustAmountAtomic: text("dust_amount_atomic").notNull().default("0"),
    rewardDecimals: integer("reward_decimals"),
    merkleRoot: text("merkle_root"),
    allocationHash: text("allocation_hash"),
    state: text("state").notNull().default("accruing"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    closedAt: text("closed_at"),
  },
  (table) => [
    index("idx_reward_epochs_launch_state").on(table.launchId, table.state),
    uniqueIndex("idx_reward_epochs_one_active")
      .on(table.launchId)
      .where(sql`${table.state} IN ('accruing', 'allocating')`),
  ],
);

export const rewardClaims = sqliteTable(
  "reward_claims",
  {
    id: text("id").primaryKey(),
    epochId: text("epoch_id").notNull().references(() => rewardEpochs.id),
    solanaWallet: text("solana_wallet").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    destinationChain: text("destination_chain").notNull().default("solana"),
    destinationAddress: text("destination_address"),
    claimFeeAtomic: text("claim_fee_atomic").notNull().default("0"),
    claimRequestedAt: text("claim_requested_at"),
    claimSignature: text("claim_signature"),
    confirmedSlot: integer("confirmed_slot"),
    state: text("state").notNull().default("claimable"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_reward_claims_epoch_wallet").on(table.epochId, table.solanaWallet),
    uniqueIndex("idx_reward_claims_claim_signature").on(table.claimSignature)
      .where(sql`${table.claimSignature} IS NOT NULL`),
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
    burnSignature: text("burn_signature"),
    verifiedSlot: integer("verified_slot"),
    attempt: integer("attempt").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_settlement_steps_idempotency").on(table.idempotencyKey),
    uniqueIndex("idx_settlement_steps_signature").on(table.txSignature),
    uniqueIndex("idx_settlement_steps_burn_signature").on(table.burnSignature)
      .where(sql`${table.burnSignature} IS NOT NULL`),
    index("idx_settlement_steps_settlement_stage").on(table.settlementId, table.stage),
    index("idx_settlement_steps_state").on(table.state),
    uniqueIndex("idx_settlement_steps_one_active_reward_chunk").on(table.settlementId)
      .where(sql`${table.stage} = 'automatic_reward_chunk' AND ${table.state} <> 'verified'`),
    uniqueIndex("idx_settlement_steps_one_active_buyback_chunk").on(table.settlementId)
      .where(sql`${table.stage} = 'automatic_buyback_chunk' AND ${table.state} <> 'verified'`),
  ],
);

export const rewardVaults = sqliteTable(
  "reward_vaults",
  {
    id: text("id").primaryKey(),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    rewardMint: text("reward_mint").notNull(),
    chain: text("chain").notNull().default("solana"),
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

export const automationJobs = sqliteTable(
  "automation_jobs",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    chain: text("chain").notNull(),
    payloadJson: text("payload_json").notNull(),
    state: text("state").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    txHash: text("tx_hash"),
    errorCode: text("error_code"),
    /** Only a new Chiliz claim retry job may point at a failed original job. */
    retryOfJobId: text("retry_of_job_id"),
    availableAt: integer("available_at").notNull(),
    leasedUntil: integer("leased_until"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_automation_job_entity_type").on(table.entityId, table.jobType),
    uniqueIndex("idx_automation_jobs_retry_of_job").on(table.retryOfJobId)
      .where(sql`${table.retryOfJobId} IS NOT NULL`),
    uniqueIndex("idx_automation_jobs_tx_hash").on(table.txHash).where(sql`${table.txHash} IS NOT NULL`),
    index("idx_automation_jobs_state_available").on(table.state, table.availableAt),
  ],
);

/** Two independently armed, one-shot Chiliz canaries: purchase <=9 CHZ and
 * claim <=1 CHZ, including gas. No row is seeded by migration. Pausing after
 * reservation cannot erase a signed transaction. */
export const chilizIntentPolicy = sqliteTable(
  "chiliz_intent_policy",
  {
    key: text("key").primaryKey(),
    authorizedJobId: text("authorized_job_id").references(() => automationJobs.id),
    reservedIntentId: text("reserved_intent_id"),
    maxTotalSpendWei: text("max_total_spend_wei").notNull(),
    state: text("state").notNull().default("paused"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_chiliz_policy_authorized_job").on(table.authorizedJobId)
      .where(sql`${table.authorizedJobId} IS NOT NULL`),
    uniqueIndex("idx_chiliz_policy_reserved_intent").on(table.reservedIntentId)
      .where(sql`${table.reservedIntentId} IS NOT NULL`),
    check("chk_chiliz_policy_slots", sql`${table.key} IN ('purchase_canary', 'claim_canary')`),
    check("chk_chiliz_policy_state", sql`${table.state} IN ('paused', 'armed', 'reserved')`),
    check("chk_chiliz_policy_reservation", sql`${table.state} <> 'reserved' OR (${table.authorizedJobId} IS NOT NULL AND ${table.reservedIntentId} IS NOT NULL)`),
    check("chk_chiliz_policy_arm", sql`${table.state} <> 'armed' OR (${table.authorizedJobId} IS NOT NULL AND ${table.reservedIntentId} IS NULL)`),
    check("chk_chiliz_policy_cap", sql`${table.maxTotalSpendWei} GLOB '[1-9]*' AND ${table.maxTotalSpendWei} NOT GLOB '*[^0-9]*' AND (length(${table.maxTotalSpendWei}) < 19 OR (length(${table.maxTotalSpendWei}) = 19 AND ((${table.key} = 'purchase_canary' AND ${table.maxTotalSpendWei} <= '9000000000000000000') OR (${table.key} = 'claim_canary' AND ${table.maxTotalSpendWei} <= '1000000000000000000'))))`),
  ],
);

/** Signed raw EVM transactions are bearer-spend material; this table is only
 * accessed by internal worker routes. Each job and treasury nonce is frozen
 * to one immutable signed transaction, including after a reverted receipt. */
export const chilizSignedIntents = sqliteTable(
  "chiliz_signed_intents",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => automationJobs.id),
    attempt: integer("attempt").notNull(),
    chainId: integer("chain_id").notNull(),
    treasuryAddress: text("treasury_address").notNull(),
    nonce: integer("nonce").notNull(),
    kind: text("kind").notNull(),
    fanTokenContract: text("fan_token_contract").notNull(),
    txHash: text("tx_hash").notNull(),
    rawTransaction: text("raw_transaction").notNull(),
    intentJson: text("intent_json").notNull(),
    maximumPrincipalWei: text("maximum_principal_wei").notNull(),
    maximumNetworkFeeWei: text("maximum_network_fee_wei").notNull(),
    maximumTotalSpendWei: text("maximum_total_spend_wei").notNull(),
    state: text("state").notNull().default("prepared"),
    broadcastAttemptedAt: integer("broadcast_attempted_at"),
    receiptStatus: text("receipt_status"),
    receiptBlockHash: text("receipt_block_hash"),
    receiptBlockNumber: integer("receipt_block_number"),
    canonicalReceiptBlockHash: text("canonical_receipt_block_hash"),
    finalizedBlockNumber: integer("finalized_block_number"),
    gasUsed: text("gas_used"),
    effectiveGasPriceWei: text("effective_gas_price_wei"),
    networkFeeWei: text("network_fee_wei"),
    principalSpentWei: text("principal_spent_wei"),
    totalSpentWei: text("total_spent_wei"),
    evidenceJson: text("evidence_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_chiliz_intent_job").on(table.jobId),
    uniqueIndex("idx_chiliz_intent_job_attempt").on(table.jobId, table.attempt),
    uniqueIndex("idx_chiliz_intent_treasury_nonce").on(table.treasuryAddress, table.nonce),
    uniqueIndex("idx_chiliz_intent_tx_hash").on(table.txHash),
    index("idx_chiliz_intent_state").on(table.state),
    check("chk_chiliz_intent_chain", sql`${table.chainId} = 88888`),
    check("chk_chiliz_intent_attempt", sql`${table.attempt} = 1`),
    check("chk_chiliz_intent_nonce", sql`${table.nonce} >= 0`),
    check("chk_chiliz_intent_kind", sql`${table.kind} IN ('purchase', 'claim')`),
    check("chk_chiliz_intent_state", sql`${table.state} IN ('prepared', 'broadcast_attempted', 'finalized_success', 'finalized_reverted')`),
  ],
);

/** One new claim job may follow a canonically finalized reverted Chiliz claim.
 * Its predecessor proof and the combined 1 CHZ gas ceiling are immutable.
 * No row is seeded; every authorization starts paused. */
export const chilizClaimRetryPolicy = sqliteTable(
  "chiliz_claim_retry_policy",
  {
    jobId: text("job_id").primaryKey().references(() => automationJobs.id),
    predecessorJobId: text("predecessor_job_id").notNull().references(() => automationJobs.id),
    predecessorIntentId: text("predecessor_intent_id").notNull().references(() => chilizSignedIntents.id),
    predecessorTxHash: text("predecessor_tx_hash").notNull(),
    predecessorReceiptBlockHash: text("predecessor_receipt_block_hash").notNull(),
    predecessorReceiptBlockNumber: integer("predecessor_receipt_block_number").notNull(),
    predecessorFinalizedBlockNumber: integer("predecessor_finalized_block_number").notNull(),
    predecessorEvidenceJson: text("predecessor_evidence_json").notNull(),
    predecessorSpentWei: text("predecessor_spent_wei").notNull(),
    maxRetrySpendWei: text("max_retry_spend_wei").notNull(),
    state: text("state").notNull().default("paused"),
    reservedIntentId: text("reserved_intent_id").references(() => chilizSignedIntents.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_chiliz_claim_retry_predecessor_job").on(table.predecessorJobId),
    uniqueIndex("idx_chiliz_claim_retry_predecessor_intent").on(table.predecessorIntentId),
    uniqueIndex("idx_chiliz_claim_retry_reserved_intent").on(table.reservedIntentId)
      .where(sql`${table.reservedIntentId} IS NOT NULL`),
    check("chk_chiliz_claim_retry_state", sql`${table.state} IN ('paused', 'armed', 'reserved')`),
    check("chk_chiliz_claim_retry_reservation", sql`${table.state} <> 'reserved' OR ${table.reservedIntentId} IS NOT NULL`),
    check("chk_chiliz_claim_retry_cap", sql`${table.predecessorSpentWei} GLOB '[0-9]*' AND ${table.predecessorSpentWei} NOT GLOB '*[^0-9]*' AND (${table.predecessorSpentWei} = '0' OR substr(${table.predecessorSpentWei},1,1) <> '0') AND ${table.maxRetrySpendWei} GLOB '[1-9]*' AND ${table.maxRetrySpendWei} NOT GLOB '*[^0-9]*' AND length(${table.predecessorSpentWei}) <= 19 AND length(${table.maxRetrySpendWei}) <= 19 AND CAST(${table.predecessorSpentWei} AS INTEGER) + CAST(${table.maxRetrySpendWei} AS INTEGER) <= 1000000000000000000`),
  ],
);

/** One explicitly armed bridge canary. No row is seeded by migration. Once a
 * transaction is reserved the policy cannot be reset or used a second time. */
export const chilizBridgePolicy = sqliteTable(
  "chiliz_bridge_policy",
  {
    key: text("key").primaryKey(),
    sourceWallet: text("source_wallet").notNull(),
    destinationTreasury: text("destination_treasury").notNull(),
    maxSourceAmountAtomic: text("max_source_amount_atomic").notNull(),
    reservedBridgeId: text("reserved_bridge_id"),
    state: text("state").notNull().default("paused"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_chiliz_bridge_policy_reservation").on(table.reservedBridgeId)
      .where(sql`${table.reservedBridgeId} IS NOT NULL`),
    check("chk_chiliz_bridge_policy_key", sql`${table.key} = 'initial'`),
    check("chk_chiliz_bridge_policy_state", sql`${table.state} IN ('paused', 'armed', 'reserved')`),
    check("chk_chiliz_bridge_policy_reservation", sql`${table.state} <> 'reserved' OR ${table.reservedBridgeId} IS NOT NULL`),
    check("chk_chiliz_bridge_policy_unreserved", sql`${table.state} <> 'armed' OR ${table.reservedBridgeId} IS NULL`),
    check("chk_chiliz_bridge_policy_source", sql`length(${table.sourceWallet}) BETWEEN 32 AND 44`),
    check("chk_chiliz_bridge_policy_destination", sql`length(${table.destinationTreasury}) = 42 AND substr(${table.destinationTreasury},1,2) = '0x' AND substr(${table.destinationTreasury},3) NOT GLOB '*[^0-9a-f]*'`),
    check("chk_chiliz_bridge_policy_cap", sql`${table.maxSourceAmountAtomic} GLOB '[1-9]*' AND ${table.maxSourceAmountAtomic} NOT GLOB '*[^0-9]*' AND (length(${table.maxSourceAmountAtomic}) < 10 OR (length(${table.maxSourceAmountAtomic}) = 10 AND ${table.maxSourceAmountAtomic} <= '1000000000'))`),
  ],
);

/** A single immutable signed Solana CHZ bridge transaction and its eventual
 * Chiliz delivery evidence. Broadcast ambiguity is permanently held: there
 * is no schema transition back to prepared and no replacement signature. */
export const chilizBridgeJournal = sqliteTable(
  "chiliz_bridge_journal",
  {
    id: text("id").primaryKey(),
    policyKey: text("policy_key").notNull().references(() => chilizBridgePolicy.key),
    sourceChain: text("source_chain").notNull(),
    destinationChainId: integer("destination_chain_id").notNull(),
    sourceMint: text("source_mint").notNull(),
    destinationAsset: text("destination_asset").notNull(),
    sourceWallet: text("source_wallet").notNull(),
    destinationTreasury: text("destination_treasury").notNull(),
    sourceAmountAtomic: text("source_amount_atomic").notNull(),
    minimumDestinationWei: text("minimum_destination_wei").notNull(),
    quoteId: text("quote_id").notNull(),
    quoteExpiresAtMs: integer("quote_expires_at_ms").notNull(),
    routeType: text("route_type").notNull(),
    signedTransactionBase64: text("signed_transaction_base64").notNull(),
    signedTransactionSha256: text("signed_transaction_sha256").notNull(),
    sourceSignature: text("source_signature").notNull(),
    state: text("state").notNull().default("prepared"),
    broadcastAttemptedAtMs: integer("broadcast_attempted_at_ms"),
    sourceFinalizedSlot: integer("source_finalized_slot"),
    sourceEvidenceJson: text("source_evidence_json"),
    bridgeMessageId: text("bridge_message_id"),
    destinationTxHash: text("destination_tx_hash"),
    destinationFinalizedBlock: integer("destination_finalized_block"),
    destinationReceivedWei: text("destination_received_wei"),
    destinationEvidenceJson: text("destination_evidence_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_chiliz_bridge_journal_policy").on(table.policyKey),
    uniqueIndex("idx_chiliz_bridge_journal_quote").on(table.quoteId),
    uniqueIndex("idx_chiliz_bridge_journal_signature").on(table.sourceSignature),
    uniqueIndex("idx_chiliz_bridge_journal_signed_sha256").on(table.signedTransactionSha256),
    uniqueIndex("idx_chiliz_bridge_journal_message").on(table.bridgeMessageId)
      .where(sql`${table.bridgeMessageId} IS NOT NULL`),
    uniqueIndex("idx_chiliz_bridge_journal_destination_tx").on(table.destinationTxHash)
      .where(sql`${table.destinationTxHash} IS NOT NULL`),
    index("idx_chiliz_bridge_journal_state").on(table.state),
    check("chk_chiliz_bridge_source_chain", sql`${table.sourceChain} = 'solana'`),
    check("chk_chiliz_bridge_destination_chain", sql`${table.destinationChainId} = 88888`),
    check("chk_chiliz_bridge_source_mint", sql`${table.sourceMint} = '6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw'`),
    check("chk_chiliz_bridge_destination_asset", sql`${table.destinationAsset} = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'`),
    check("chk_chiliz_bridge_route", sql`${table.routeType} IN ('OFT', 'OFT_V2')`),
    check("chk_chiliz_bridge_state", sql`${table.state} IN ('prepared', 'broadcast_attempted', 'source_finalized', 'destination_finalized', 'held')`),
    check("chk_chiliz_bridge_source_amount", sql`${table.sourceAmountAtomic} GLOB '[1-9]*' AND ${table.sourceAmountAtomic} NOT GLOB '*[^0-9]*'`),
    check("chk_chiliz_bridge_min_destination", sql`${table.minimumDestinationWei} GLOB '[1-9]*' AND ${table.minimumDestinationWei} NOT GLOB '*[^0-9]*'`),
    check("chk_chiliz_bridge_sha256", sql`length(${table.signedTransactionSha256}) = 64 AND ${table.signedTransactionSha256} NOT GLOB '*[^0-9a-f]*'`),
    check("chk_chiliz_bridge_signature", sql`length(${table.sourceSignature}) BETWEEN 64 AND 88`),
  ],
);

/** Recurring Pump V2 fee collection is opt-in per published community coin.
 * The migration seeds no policy. The collector only pays Solana transaction
 * fees; it is never one of the 80/20 fee recipients or the launch creator. */
export const pumpFeeCollectionPolicies = sqliteTable(
  "pump_fee_collection_policies",
  {
    launchId: text("launch_id").primaryKey().references(() => launchDrafts.id),
    mint: text("mint").notNull(),
    collectorSigner: text("collector_signer").notNull(),
    rewardTreasury: text("reward_treasury").notNull(),
    buybackTreasury: text("buyback_treasury").notNull(),
    state: text("state").notNull().default("paused"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_pump_fee_collection_policy_mint").on(table.mint),
    check("chk_pump_fee_collection_policy_state", sql`${table.state} IN ('paused', 'armed')`),
    check("chk_pump_fee_collection_policy_signer", sql`length(${table.collectorSigner}) BETWEEN 32 AND 44 AND ${table.collectorSigner} <> ${table.rewardTreasury} AND ${table.collectorSigner} <> ${table.buybackTreasury}`),
    check("chk_pump_fee_collection_policy_treasuries", sql`${table.rewardTreasury} <> ${table.buybackTreasury}`),
  ],
);

/** A signed collection transaction is recorded before any broadcast. The
 * signed instruction effects are unverified at insert. A future independent
 * verifier must attest the exact Pump V2 80/20 instructions before broadcast.
 * No worker, signer, attestor, or broadcaster uses this table yet. */
export const pumpFeeCollectionIntents = sqliteTable(
  "pump_fee_collection_intents",
  {
    id: text("id").primaryKey(),
    launchId: text("launch_id").notNull().references(() => pumpFeeCollectionPolicies.launchId),
    mint: text("mint").notNull(),
    collectorSigner: text("collector_signer").notNull(),
    rewardTreasury: text("reward_treasury").notNull(),
    buybackTreasury: text("buyback_treasury").notNull(),
    recentBlockhash: text("recent_blockhash").notNull(),
    lastValidBlockHeight: integer("last_valid_block_height").notNull(),
    historyAnchorSignature: text("history_anchor_signature").notNull(),
    signedTransactionBase64: text("signed_transaction_base64").notNull(),
    signedTransactionSha256: text("signed_transaction_sha256").notNull(),
    sourceSignature: text("source_signature").notNull(),
    instructionEffectState: text("instruction_effect_state").notNull().default("unverified"),
    instructionEvidenceJson: text("instruction_evidence_json"),
    state: text("state").notNull().default("prepared"),
    broadcastAttemptedAtMs: integer("broadcast_attempted_at_ms"),
    finalizedSlot: integer("finalized_slot"),
    finalizedEvidenceJson: text("finalized_evidence_json"),
    expiredObservedBlockHeight: integer("expired_observed_block_height"),
    expiryEvidenceJson: text("expiry_evidence_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_pump_fee_collection_intent_signature").on(table.sourceSignature),
    uniqueIndex("idx_pump_fee_collection_intent_signed_sha256").on(table.signedTransactionSha256),
    uniqueIndex("idx_pump_fee_collection_one_unresolved").on(table.launchId)
      .where(sql`${table.state} IN ('prepared', 'broadcast_attempted', 'held')`),
    index("idx_pump_fee_collection_intent_launch_state").on(table.launchId, table.state),
    check("chk_pump_fee_collection_intent_state", sql`${table.state} IN ('prepared', 'broadcast_attempted', 'held', 'finalized', 'expired')`),
    check("chk_pump_fee_collection_effect_state", sql`${table.instructionEffectState} IN ('unverified', 'verified')`),
    check("chk_pump_fee_collection_block_height", sql`${table.lastValidBlockHeight} > 0`),
    check("chk_pump_fee_collection_signer", sql`${table.collectorSigner} <> ${table.rewardTreasury} AND ${table.collectorSigner} <> ${table.buybackTreasury}`),
    check("chk_pump_fee_collection_treasuries", sql`${table.rewardTreasury} <> ${table.buybackTreasury}`),
    check("chk_pump_fee_collection_sha256", sql`length(${table.signedTransactionSha256}) = 64 AND ${table.signedTransactionSha256} NOT GLOB '*[^0-9a-f]*'`),
    check("chk_pump_fee_collection_signature", sql`length(${table.sourceSignature}) BETWEEN 64 AND 88 AND ${table.sourceSignature} <> ${table.historyAnchorSignature}`),
  ],
);

export const protocolSettings = sqliteTable("protocol_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedByUserId: text("updated_by_user_id"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
    lastObservedAt: integer("last_observed_at"),
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

// Multi-batch holder observations live here until an atomic set-based commit
// replaces the epoch's canonical positions. Incomplete generations are inert.
export const holderSnapshotStaging = sqliteTable(
  "holder_snapshot_staging",
  {
    generationId: text("generation_id").notNull(),
    epochId: text("epoch_id").notNull().references(() => rewardEpochs.id),
    launchId: text("launch_id").notNull().references(() => launchDrafts.id),
    wallet: text("wallet").notNull(),
    tokenSecondsAtomic: text("token_seconds_atomic").notNull(),
    endingBalanceAtomic: text("ending_balance_atomic").notNull(),
    observedSlot: integer("observed_slot").notNull(),
    observedAt: integer("observed_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_holder_snapshot_stage_generation_wallet").on(table.generationId, table.wallet),
    index("idx_holder_snapshot_stage_epoch").on(table.epochId),
  ],
);

export const holderSnapshotCheckpoints = sqliteTable("holder_snapshot_checkpoints", {
  epochId: text("epoch_id").primaryKey().references(() => rewardEpochs.id),
  generationId: text("generation_id").notNull(),
  // Null on legacy checkpoints: they cannot prove coverage from epoch start.
  firstFinalizedAt: integer("first_finalized_at"),
  lastObservedSlot: integer("last_observed_slot").notNull(),
  lastObservedAt: integer("last_observed_at").notNull(),
  positionCount: integer("position_count").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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

export const transactionIntents = sqliteTable(
  "transaction_intents",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    settlementId: text("settlement_id").references(() => settlements.id),
    rewardBatchId: text("reward_batch_id").references(() => rewardSwapBatches.id),
    claimId: text("claim_id").references(() => rewardClaims.id),
    // A finalized signature on the source token account, captured before a
    // signed claim is broadcast. Recovery scans back through this anchor.
    claimHistoryAnchorSignature: text("claim_history_anchor_signature"),
    signerRole: text("signer_role").notNull(),
    signerAddress: text("signer_address"),
    action: text("action").notNull(),
    state: text("state").notNull().default("planned"),
    expectedProgramsJson: text("expected_programs_json").notNull(),
    expectedMintsJson: text("expected_mints_json").notNull(),
    maximumSpendLamports: text("maximum_spend_lamports").notNull(),
    providerRequestId: text("provider_request_id"),
    unsignedTransactionBase64: text("unsigned_transaction_base64"),
    transactionMessageHash: text("transaction_message_hash"),
    lastValidBlockHeight: integer("last_valid_block_height"),
    inputMint: text("input_mint"),
    outputMint: text("output_mint"),
    inputAmountAtomic: text("input_amount_atomic"),
    minimumOutputAtomic: text("minimum_output_atomic"),
    txSignature: text("tx_signature"),
    expiresAt: text("expires_at").notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_transaction_intents_idempotency").on(table.idempotencyKey),
    uniqueIndex("idx_transaction_intents_signature").on(table.txSignature),
    index("idx_transaction_intents_state_created").on(table.state, table.createdAt),
    index("idx_transaction_intents_settlement_action").on(table.settlementId, table.action),
    // Exactly one immutable signed purchase may consume a reserved batch.
    uniqueIndex("idx_transaction_intents_reward_batch").on(table.rewardBatchId)
      .where(sql`${table.rewardBatchId} IS NOT NULL`),
    index("idx_transaction_intents_claim_action").on(table.claimId, table.action),
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
