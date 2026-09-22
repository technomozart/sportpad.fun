import { env } from "cloudflare:workers";
import { PublicKey, Transaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { Buffer } from "buffer";

import { allocateEpochRewards } from "@/lib/protocol/accounting";
import { isCommunityLaunchFeeSource } from "@/lib/protocol/fee-policy";
import { canonicalRewardAllocation } from "@/lib/protocol/holder-rewards";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/protocol/pump-devnet-verification";
import { associatedTokenAddress } from "@/lib/protocol/spl-burn";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { readMainnetConfig } from "@/lib/server/mainnet-config";
import { isOperatorRequest } from "@/lib/server/publication-policy";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";
import { getMainnetConnection } from "@/lib/server/solana/devnet";
import {
  prepareRewardPayout,
  rewardPayoutMessageHash,
  submitAndConfirmRewardPayout,
} from "@/lib/server/solana/reward-payout";
import { getVerifiedWalletSession } from "@/lib/server/wallet-session";
import { runHolderIndexer } from "@/lib/server/workers/holder-indexer";

const database = env.DB as D1Database;

type LaunchRow = {
  id: string;
  name: string;
  symbol: string;
  mainnet_mint: string;
  reward_symbol: string;
  reward_mint: string;
  mainnet_reward_treasury: string;
};
type EpochRow = {
  id: string;
  launch_id: string;
  starts_at: string;
  ends_at: string;
  cutoff_slot: number | null;
  funded_amount_atomic: string;
  allocated_amount_atomic: string;
  dust_amount_atomic: string;
  reward_decimals: number | null;
  allocation_hash: string | null;
  state: string;
  created_at: string;
  closed_at: string | null;
  launch_name: string;
  launch_symbol: string;
  reward_symbol: string;
};
type ClaimRow = {
  id: string;
  epoch_id: string;
  solana_wallet: string;
  amount_atomic: string;
  claim_signature: string | null;
  confirmed_slot: number | null;
  state: string;
  launch_id: string;
  launch_name: string;
  launch_symbol: string;
  reward_symbol: string;
  reward_mint: string;
  reward_decimals: number;
  reward_treasury: string;
  pending_signature?: string | null;
};
type IntentRow = {
  id: string;
  claim_id: string;
  signer_address: string;
  state: string;
  transaction_message_hash: string;
  last_valid_block_height: number;
  input_mint: string;
  input_amount_atomic: string;
  provider_request_id: string;
  expires_at: string;
};
type PositionRow = { wallet: string; token_seconds_atomic: string; last_observed_slot: number | null };

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function launchById(id: string) {
  const launch = await database.prepare(`
    SELECT id, name, symbol, mainnet_mint, reward_symbol, reward_mint, mainnet_reward_treasury
    FROM launch_drafts
    WHERE id = ?1 AND status = 'mainnet_published' AND mainnet_mint IS NOT NULL
      AND reward_mint IS NOT NULL AND mainnet_reward_treasury IS NOT NULL
    LIMIT 1
  `).bind(id).first<LaunchRow>();
  return launch && isCommunityLaunchFeeSource(launch.mainnet_mint, readMainnetConfig().sportpadMint)
    ? launch
    : null;
}

async function claimById(id: string) {
  return database.prepare(`
    SELECT c.id, c.epoch_id, c.solana_wallet, c.amount_atomic, c.claim_signature,
      c.confirmed_slot, c.state, e.launch_id, l.name AS launch_name,
      l.symbol AS launch_symbol, l.reward_symbol, l.reward_mint,
      e.reward_decimals, l.mainnet_reward_treasury AS reward_treasury
    FROM reward_claims c
    JOIN reward_epochs e ON e.id = c.epoch_id
    JOIN launch_drafts l ON l.id = e.launch_id
    WHERE c.id = ?1 AND l.reward_mint IS NOT NULL AND e.reward_decimals IS NOT NULL
      AND l.mainnet_reward_treasury IS NOT NULL
    LIMIT 1
  `).bind(id).first<ClaimRow>();
}

async function requireRewardExecution() {
  const control = await database.prepare("SELECT settlement_paused, rewards_paused FROM protocol_controls WHERE key = 'global' LIMIT 1")
    .first<{ settlement_paused: number; rewards_paused: number }>();
  if (!control || control.settlement_paused || control.rewards_paused) {
    throw new Error("Reward execution is paused by the protocol control plane.");
  }
}

async function recordConfirmedPayout(claim: ClaimRow, intentId: string, receipt: { signature: string; slot: number }) {
  await database.batch([
    database.prepare("UPDATE transaction_intents SET state = 'confirmed', tx_signature = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state IN ('submitting', 'submission_unknown')").bind(intentId, receipt.signature),
    database.prepare("UPDATE reward_claims SET state = 'confirmed', claim_signature = ?2, confirmed_slot = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state IN ('submitting', 'submission_unknown')").bind(claim.id, receipt.signature, receipt.slot),
    database.prepare(`
      UPDATE reward_epochs SET state = 'complete', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND state = 'claimable'
        AND NOT EXISTS (
          SELECT 1 FROM reward_claims c
          WHERE c.epoch_id = ?1 AND c.id <> ?2 AND c.state <> 'confirmed'
        )
    `).bind(claim.epoch_id, claim.id),
    database.prepare(`
      UPDATE reward_vaults SET
        reserved_atomic = CAST(reserved_atomic AS INTEGER) - CAST(?3 AS INTEGER),
        claimed_atomic = CAST(claimed_atomic AS INTEGER) + CAST(?3 AS INTEGER),
        updated_at = CURRENT_TIMESTAMP
      WHERE launch_id = ?1 AND reward_mint = ?2
    `).bind(claim.launch_id, claim.reward_mint, claim.amount_atomic),
    database.prepare(`
      INSERT OR IGNORE INTO protocol_events (
        id, category, entity_type, entity_id, event_type, idempotency_key, state,
        signature, slot, amount_atomic, mint
      ) VALUES (?1, 'rewards', 'claim', ?2, 'fan_token_payout_confirmed', ?1,
        'confirmed', ?3, ?4, ?5, ?6)
    `).bind(`reward-payout:${claim.id}`, claim.id, receipt.signature, receipt.slot, claim.amount_atomic, claim.reward_mint),
  ]);
}

async function rewardInventory(launch: LaunchRow, excludingEpochId?: string) {
  const [steps, funded, outstanding] = await Promise.all([
    database.prepare(`
      SELECT ss.output_amount_atomic
      FROM settlement_steps ss
      JOIN settlements s ON s.id = ss.settlement_id
      JOIN fee_events f ON f.id = s.fee_event_id
      WHERE f.launch_id = ?1 AND ss.stage = 'reward_swap' AND ss.state = 'submitted'
        AND ss.output_amount_atomic IS NOT NULL AND ss.tx_signature IS NOT NULL
    `).bind(launch.id).all<{ output_amount_atomic: string }>(),
    database.prepare(`
      SELECT funded_amount_atomic FROM reward_epochs
      WHERE launch_id = ?1 AND state IN ('allocating', 'claimable', 'complete')
        ${excludingEpochId ? "AND id <> ?2" : ""}
    `).bind(...(excludingEpochId ? [launch.id, excludingEpochId] : [launch.id])).all<{ funded_amount_atomic: string }>(),
    database.prepare(`
      SELECT c.amount_atomic FROM reward_claims c
      JOIN reward_epochs e ON e.id = c.epoch_id
      WHERE e.launch_id = ?1 AND c.state IN ('claimable', 'submitting', 'submitted', 'submission_unknown')
    `).bind(launch.id).all<{ amount_atomic: string }>(),
  ]);
  const acquiredAtomic = steps.results.reduce((sum, row) => sum + BigInt(row.output_amount_atomic), 0n);
  const previouslyFundedAtomic = funded.results.reduce((sum, row) => sum + BigInt(row.funded_amount_atomic), 0n);
  const outstandingAtomic = outstanding.results.reduce((sum, row) => sum + BigInt(row.amount_atomic), 0n);
  const ledgerAvailable = acquiredAtomic > previouslyFundedAtomic ? acquiredAtomic - previouslyFundedAtomic : 0n;

  const rpc = getMainnetConnection();
  const mint = new PublicKey(launch.reward_mint);
  const mintAccount = await rpc.getAccountInfo(mint, "confirmed");
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) {
    throw new Error("The configured official Fan Token is not a supported SPL mint.");
  }
  const [supply, treasuryBalance] = await Promise.all([
    rpc.getTokenSupply(mint, "confirmed"),
    rpc.getTokenAccountBalance(
      associatedTokenAddress(mint, new PublicKey(launch.mainnet_reward_treasury), mintAccount.owner),
      "confirmed",
    ).catch(() => null),
  ]);
  const onchainBalance = treasuryBalance ? BigInt(treasuryBalance.value.amount) : 0n;
  const unreservedOnchain = onchainBalance > outstandingAtomic ? onchainBalance - outstandingAtomic : 0n;
  return {
    acquiredAtomic,
    availableAtomic: ledgerAvailable < unreservedOnchain ? ledgerAvailable : unreservedOnchain,
    outstandingAtomic,
    decimals: supply.value.decimals,
    tokenAccount: associatedTokenAddress(mint, new PublicKey(launch.mainnet_reward_treasury), mintAccount.owner).toBase58(),
  };
}

async function startEpoch(launchId: string, actor: string) {
  const launch = await launchById(launchId);
  if (!launch) throw new Error("A verified mainnet launch is required.");
  const active = await database.prepare("SELECT id FROM reward_epochs WHERE launch_id = ?1 AND state IN ('accruing', 'allocating') LIMIT 1")
    .bind(launch.id).first<{ id: string }>();
  if (active) throw new Error("That launch already has an active reward epoch.");
  const inventory = await rewardInventory(launch);
  if (inventory.availableAtomic <= 0n) throw new Error("Buy official Fan Token inventory before opening an epoch.");
  const epochId = crypto.randomUUID();
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  await database.batch([
    database.prepare(`
      INSERT INTO reward_epochs (id, launch_id, starts_at, ends_at, reward_decimals, state)
      VALUES (?1, ?2, ?3, ?4, ?5, 'accruing')
    `).bind(epochId, launch.id, startsAt.toISOString(), endsAt.toISOString(), inventory.decimals),
    database.prepare(`
      INSERT INTO protocol_events (id, category, entity_type, entity_id, event_type, idempotency_key, state, amount_atomic, mint, evidence_hash)
      VALUES (?1, 'rewards', 'epoch', ?2, 'reward_epoch_opened', ?1, 'verified', ?3, ?4, ?5)
    `).bind(`epoch-open:${epochId}`, epochId, inventory.availableAtomic.toString(), launch.reward_mint, await sha256Hex(`${actor}:${epochId}:${startsAt.toISOString()}`)),
  ]);
  await runHolderIndexer("operator", epochId);
  return epochId;
}

async function closeEpoch(epochId: string) {
  const epoch = await database.prepare(`
    SELECT e.id, e.launch_id, e.state, e.funded_amount_atomic,
      e.allocated_amount_atomic, e.dust_amount_atomic, e.reward_decimals,
      e.allocation_hash, l.id, l.name, l.symbol, l.mainnet_mint,
      l.reward_symbol, l.reward_mint, l.mainnet_reward_treasury
    FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
    WHERE e.id = ?1 AND e.state IN ('accruing', 'allocating')
      AND l.status = 'mainnet_published' AND l.mainnet_mint IS NOT NULL
      AND l.reward_mint IS NOT NULL AND l.mainnet_reward_treasury IS NOT NULL
    LIMIT 1
  `).bind(epochId).first<LaunchRow & {
    state: string; launch_id: string; funded_amount_atomic: string;
    allocated_amount_atomic: string; dust_amount_atomic: string;
    reward_decimals: number | null; allocation_hash: string | null;
  }>();
  if (!epoch) throw new Error("An active reward epoch is required.");
  if (epoch.state === "accruing") {
    await runHolderIndexer("operator", epochId);
  }
  const launch = await launchById(epoch.launch_id);
  if (!launch) throw new Error("The epoch launch is no longer publishable.");
  const inventory = await rewardInventory(launch, epochId);
  const fixedFunding = BigInt(epoch.funded_amount_atomic);
  const fundedAtomic = fixedFunding > 0n ? fixedFunding : inventory.availableAtomic;
  if (fundedAtomic <= 0n) throw new Error("No unallocated Fan Token inventory is available.");
  const positions = await database.prepare(`
    SELECT wallet, token_seconds_atomic, last_observed_slot
    FROM holder_epoch_positions
    WHERE epoch_id = ?1 AND excluded = 0 AND CAST(token_seconds_atomic AS INTEGER) > 0
    ORDER BY wallet
  `).bind(epochId).all<PositionRow>();
  const allocation = allocateEpochRewards(fundedAtomic, positions.results.map((position) => ({
    wallet: position.wallet,
    tokenSeconds: BigInt(position.token_seconds_atomic),
  })));
  const nonZero = allocation.allocations.filter((entry) => entry.rewardAtomic > 0n);
  if (!nonZero.length) throw new Error("At least two finalized holder observations are required before allocation.");
  const allocationHash = await sha256Hex(canonicalRewardAllocation(nonZero));
  const allocatedAtomic = nonZero.reduce((sum, entry) => sum + entry.rewardAtomic, 0n);
  const cutoffSlot = positions.results.reduce((max, row) => Math.max(max, row.last_observed_slot ?? 0), 0);
  if (fixedFunding === 0n) {
    const committed = await database.prepare(`
      UPDATE reward_epochs SET funded_amount_atomic = ?2, allocated_amount_atomic = ?3,
        dust_amount_atomic = ?4, reward_decimals = ?5, allocation_hash = ?6,
        cutoff_slot = ?7, state = 'allocating', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND state IN ('accruing', 'allocating') AND funded_amount_atomic = '0'
    `).bind(epochId, fundedAtomic.toString(), allocatedAtomic.toString(), allocation.dustAtomic.toString(), inventory.decimals, allocationHash, cutoffSlot).run();
    if (Number(committed.meta.changes ?? 0) !== 1) throw new Error("The epoch funding commitment changed while it was closing.");
  } else if (
    epoch.allocation_hash !== allocationHash ||
    epoch.allocated_amount_atomic !== allocatedAtomic.toString() ||
    epoch.dust_amount_atomic !== allocation.dustAtomic.toString()
  ) {
    throw new Error("The stored epoch commitment does not match its deterministic allocation.");
  }
  for (let offset = 0; offset < nonZero.length; offset += 75) {
    await database.batch(nonZero.slice(offset, offset + 75).map((entry) => database.prepare(`
      INSERT OR IGNORE INTO reward_claims (id, epoch_id, solana_wallet, amount_atomic, state)
      VALUES (?1, ?2, ?3, ?4, 'claimable')
    `).bind(`claim:${epochId}:${entry.wallet}`, epochId, entry.wallet, entry.rewardAtomic.toString())));
  }
  await database.batch([
    database.prepare(`
      UPDATE reward_epochs SET state = 'claimable', closed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'allocating'
    `).bind(epochId),
    database.prepare(`
      INSERT INTO reward_vaults (
        id, launch_id, reward_mint, owner_address, token_account, state,
        inventory_atomic, reserved_atomic, allocated_atomic, claimed_atomic,
        last_observed_slot, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'funded', ?6, ?7, ?7, '0', ?8, CURRENT_TIMESTAMP)
      ON CONFLICT(launch_id, reward_mint) DO UPDATE SET
        state = 'funded', inventory_atomic = excluded.inventory_atomic,
        reserved_atomic = CAST(reward_vaults.reserved_atomic AS INTEGER) + CAST(excluded.reserved_atomic AS INTEGER),
        allocated_atomic = CAST(reward_vaults.allocated_atomic AS INTEGER) + CAST(excluded.allocated_atomic AS INTEGER),
        token_account = excluded.token_account, last_observed_slot = excluded.last_observed_slot,
        updated_at = CURRENT_TIMESTAMP
    `).bind(`vault:${launch.id}:${launch.reward_mint}`, launch.id, launch.reward_mint, launch.mainnet_reward_treasury, inventory.tokenAccount, inventory.acquiredAtomic.toString(), allocatedAtomic.toString(), cutoffSlot),
    database.prepare(`
      INSERT OR IGNORE INTO protocol_events (
        id, category, entity_type, entity_id, event_type, idempotency_key, state,
        slot, amount_atomic, mint, evidence_hash
      ) VALUES (?1, 'rewards', 'epoch', ?2, 'reward_allocation_committed', ?1,
        'verified', ?3, ?4, ?5, ?6)
    `).bind(`allocation:${epochId}`, epochId, cutoffSlot, allocatedAtomic.toString(), launch.reward_mint, allocationHash),
  ]);
  return { epochId, holders: nonZero.length, fundedAtomic: fundedAtomic.toString(), allocatedAtomic: allocatedAtomic.toString(), dustAtomic: allocation.dustAtomic.toString() };
}

async function getConsoleData() {
  const [launches, epochs, claims, control] = await Promise.all([
    database.prepare(`
      SELECT l.id, l.name, l.symbol, l.mainnet_mint, l.reward_symbol, l.reward_mint,
        l.mainnet_reward_treasury
      FROM launch_drafts l
      WHERE l.status = 'mainnet_published' AND l.mainnet_mint IS NOT NULL
        AND l.reward_mint IS NOT NULL AND l.mainnet_reward_treasury IS NOT NULL
      ORDER BY l.mainnet_verified_at DESC LIMIT 100
    `).all<LaunchRow>(),
    database.prepare(`
      SELECT e.id, e.launch_id, e.starts_at, e.ends_at, e.cutoff_slot,
        e.funded_amount_atomic, e.allocated_amount_atomic, e.dust_amount_atomic,
        e.reward_decimals, e.allocation_hash, e.state, e.created_at, e.closed_at,
        l.name AS launch_name, l.symbol AS launch_symbol, l.reward_symbol
      FROM reward_epochs e JOIN launch_drafts l ON l.id = e.launch_id
      ORDER BY e.created_at DESC LIMIT 100
    `).all<EpochRow>(),
    database.prepare(`
      SELECT c.id, c.epoch_id, c.solana_wallet, c.amount_atomic, c.claim_signature,
        c.confirmed_slot, c.state, e.launch_id, l.name AS launch_name,
        l.symbol AS launch_symbol, l.reward_symbol, l.reward_mint,
        e.reward_decimals, l.mainnet_reward_treasury AS reward_treasury,
        (SELECT ti.tx_signature FROM transaction_intents ti
          WHERE ti.claim_id = c.id AND ti.action = 'reward_payout'
          ORDER BY ti.created_at DESC LIMIT 1) AS pending_signature
      FROM reward_claims c JOIN reward_epochs e ON e.id = c.epoch_id
      JOIN launch_drafts l ON l.id = e.launch_id
      WHERE c.state IN ('claimable', 'submitting', 'submitted', 'submission_unknown')
        AND l.reward_mint IS NOT NULL AND e.reward_decimals IS NOT NULL
        AND l.mainnet_reward_treasury IS NOT NULL
      ORDER BY c.created_at LIMIT 500
    `).all<ClaimRow>(),
    database.prepare("SELECT settlement_paused, rewards_paused FROM protocol_controls WHERE key = 'global' LIMIT 1")
      .first<{ settlement_paused: number; rewards_paused: number }>(),
  ]);
  return {
    controls: control ? { settlementPaused: Boolean(control.settlement_paused), rewardsPaused: Boolean(control.rewards_paused) } : null,
    launches: launches.results
      .filter((launch) => isCommunityLaunchFeeSource(launch.mainnet_mint, readMainnetConfig().sportpadMint))
      .map((launch) => ({
      id: launch.id, name: launch.name, symbol: launch.symbol, mint: launch.mainnet_mint,
      rewardSymbol: launch.reward_symbol, rewardMint: launch.reward_mint, rewardTreasury: launch.mainnet_reward_treasury,
      })),
    epochs: epochs.results.map((epoch) => ({
      id: epoch.id, launchId: epoch.launch_id, startsAt: epoch.starts_at, endsAt: epoch.ends_at,
      cutoffSlot: epoch.cutoff_slot, fundedAmountAtomic: epoch.funded_amount_atomic,
      allocatedAmountAtomic: epoch.allocated_amount_atomic, dustAmountAtomic: epoch.dust_amount_atomic,
      rewardDecimals: epoch.reward_decimals, allocationHash: epoch.allocation_hash, state: epoch.state,
      createdAt: epoch.created_at, closedAt: epoch.closed_at, launchName: epoch.launch_name,
      launchSymbol: epoch.launch_symbol, rewardSymbol: epoch.reward_symbol,
    })),
    claims: claims.results.map((claim) => ({
      id: claim.id, epochId: claim.epoch_id, wallet: claim.solana_wallet, amountAtomic: claim.amount_atomic,
      signature: claim.claim_signature, confirmedSlot: claim.confirmed_slot, state: claim.state,
      launchId: claim.launch_id, launchName: claim.launch_name, launchSymbol: claim.launch_symbol,
      rewardSymbol: claim.reward_symbol, rewardMint: claim.reward_mint, rewardDecimals: claim.reward_decimals,
      rewardTreasury: claim.reward_treasury, pendingSignature: claim.pending_signature ?? null,
    })),
  };
}

export async function GET(request: Request) {
  if (!isOperatorRequest(request)) return privateJson({ error: "Operator access is required." }, 403);
  if (!database) return privateJson({ error: "Reward database is unavailable." }, 503);
  return privateJson(await getConsoleData());
}

export async function POST(request: Request) {
  if (!isOperatorRequest(request)) return privateJson({ error: "Operator access is required." }, 403);
  if (!isSameOrigin(request)) return privateJson({ error: "Same-origin request required." }, 403);
  if (!database) return privateJson({ error: "Reward database is unavailable." }, 503);
  const actor = getLaunchDraftOwner(request);
  if (!actor) return privateJson({ error: "Operator access is required." }, 403);
  const rateLimit = await consumeFixedWindow({ scope: "operator_rewards", subject: actor, limit: 30, windowSeconds: 60 });
  if (!rateLimit.allowed) return rateLimitedJson("Too many reward actions.", rateLimit);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return privateJson({ error: "A JSON action is required." }, 400); }

  try {
    if (body.action === "start_epoch") {
      if (!validId(body.launchId)) return privateJson({ error: "A valid launch is required." }, 400);
      await requireRewardExecution();
      const epochId = await startEpoch(body.launchId, actor);
      return privateJson({ ok: true, epochId, data: await getConsoleData() });
    }
    if (body.action === "sample_epoch") {
      if (!validId(body.epochId)) return privateJson({ error: "A valid epoch is required." }, 400);
      const result = await runHolderIndexer("operator", body.epochId);
      return privateJson({ ok: true, result, data: await getConsoleData() });
    }
    if (body.action === "close_epoch") {
      if (!validId(body.epochId)) return privateJson({ error: "A valid epoch is required." }, 400);
      await requireRewardExecution();
      const result = await closeEpoch(body.epochId);
      return privateJson({ ok: true, result, data: await getConsoleData() });
    }
    if (body.action === "reconcile_payout") {
      if (!validId(body.claimId)) return privateJson({ error: "A valid reward allocation is required." }, 400);
      const claim = await claimById(body.claimId);
      if (!claim || claim.state !== "submission_unknown") return privateJson({ error: "That payout does not require reconciliation." }, 409);
      const intent = await database.prepare(`
        SELECT id, tx_signature FROM transaction_intents
        WHERE claim_id = ?1 AND action = 'reward_payout' AND state = 'submission_unknown'
        ORDER BY created_at DESC LIMIT 1
      `).bind(claim.id).first<{ id: string; tx_signature: string | null }>();
      if (!intent?.tx_signature) return privateJson({ error: "The pending payout signature is unavailable." }, 409);
      const status = await getMainnetConnection().getSignatureStatuses([intent.tx_signature], { searchTransactionHistory: true });
      const landed = status.value[0];
      if (!landed) return privateJson({ error: "The payout is still unresolved on Solana. Do not create a replacement yet." }, 409);
      if (landed.err) {
        await database.batch([
          database.prepare("UPDATE transaction_intents SET state = 'failed', error_code = 'reward_payout_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?1").bind(intent.id),
          database.prepare("UPDATE reward_claims SET state = 'claimable', updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'submission_unknown'").bind(claim.id),
        ]);
      } else {
        await recordConfirmedPayout(claim, intent.id, { signature: intent.tx_signature, slot: landed.slot });
      }
      return privateJson({ ok: true, signature: landed.err ? null : intent.tx_signature, data: await getConsoleData() });
    }
    if (body.action === "prepare_payout") {
      if (!validId(body.claimId)) return privateJson({ error: "A valid reward allocation is required." }, 400);
      await requireRewardExecution();
      const walletSession = await getVerifiedWalletSession(request);
      if (!walletSession) return privateJson({ error: "Verify the reward treasury wallet first." }, 401);
      const claim = await claimById(body.claimId);
      if (!claim || claim.state !== "claimable" || claim.claim_signature) return privateJson({ error: "That reward allocation is no longer payable." }, 409);
      if (walletSession.walletAddress !== claim.reward_treasury) return privateJson({ error: "Connect and verify the 80% reward treasury wallet." }, 403);
      const plan = await prepareRewardPayout({
        mintAddress: claim.reward_mint,
        treasuryAddress: claim.reward_treasury,
        recipientAddress: claim.solana_wallet,
        amountAtomic: claim.amount_atomic,
      });
      const intentId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 120_000).toISOString();
      await database.prepare(`
        INSERT INTO transaction_intents (
          id, idempotency_key, claim_id, signer_role, signer_address, action, state,
          expected_programs_json, expected_mints_json, maximum_spend_lamports,
          provider_request_id, unsigned_transaction_base64, transaction_message_hash,
          last_valid_block_height, input_mint, input_amount_atomic, expires_at
        ) VALUES (?1, ?2, ?3, 'reward_treasury', ?4, 'reward_payout', 'planned',
          ?5, ?6, '3000000', ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      `).bind(
        intentId, `reward-payout:${claim.id}:${plan.blockhash}`, claim.id, claim.reward_treasury,
        JSON.stringify([plan.tokenProgram]), JSON.stringify([claim.reward_mint]), plan.blockhash,
        plan.transactionBase64, plan.transactionMessageHash, plan.lastValidBlockHeight,
        claim.reward_mint, claim.amount_atomic, expiresAt,
      ).run();
      return privateJson({
        intentId, transactionBase64: plan.transactionBase64, expiresAt,
        amountAtomic: claim.amount_atomic, wallet: claim.solana_wallet,
        rewardSymbol: claim.reward_symbol, decimals: plan.decimals,
      });
    }
    if (body.action === "submit_payout") {
      if (!validUuid(body.intentId) || typeof body.signedTransactionBase64 !== "string" || body.signedTransactionBase64.length > 20_000) {
        return privateJson({ error: "A valid signed reward payout intent is required." }, 400);
      }
      await requireRewardExecution();
      const walletSession = await getVerifiedWalletSession(request);
      if (!walletSession) return privateJson({ error: "Verify the reward treasury wallet first." }, 401);
      const intent = await database.prepare(`
        SELECT id, claim_id, signer_address, state, transaction_message_hash,
          last_valid_block_height, input_mint, input_amount_atomic, provider_request_id, expires_at
        FROM transaction_intents WHERE id = ?1 AND action = 'reward_payout' LIMIT 1
      `).bind(body.intentId).first<IntentRow>();
      if (!intent || intent.state !== "planned") return privateJson({ error: "That payout intent is no longer signable." }, 409);
      if (Date.parse(intent.expires_at) <= Date.now()) return privateJson({ error: "That payout transaction expired. Prepare a new payout." }, 409);
      if (walletSession.walletAddress !== intent.signer_address) return privateJson({ error: "The signed wallet does not match this payout intent." }, 403);
      const claim = await claimById(intent.claim_id);
      if (!claim || claim.state !== "claimable" || claim.amount_atomic !== intent.input_amount_atomic || claim.reward_mint !== intent.input_mint) {
        return privateJson({ error: "The reward allocation changed before submission." }, 409);
      }
      let signed: Transaction;
      try { signed = Transaction.from(Buffer.from(body.signedTransactionBase64, "base64")); } catch { return privateJson({ error: "The signed payout transaction is unreadable." }, 400); }
      if (await rewardPayoutMessageHash(signed) !== intent.transaction_message_hash) return privateJson({ error: "The signed payout does not match the exact allocation." }, 400);
      const signer = signed.signatures.find((entry) => entry.publicKey.toBase58() === intent.signer_address);
      if (!signer?.signature || !ed25519.verify(signer.signature, signed.serializeMessage(), new PublicKey(intent.signer_address).toBytes())) {
        return privateJson({ error: "The reward treasury signature is invalid." }, 400);
      }
      const expectedSignature = bs58.encode(signer.signature);
      const claimed = await database.prepare("UPDATE transaction_intents SET state = 'submitting', updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'planned'")
        .bind(intent.id).run();
      if (Number(claimed.meta.changes ?? 0) !== 1) return privateJson({ error: "That payout is already being submitted." }, 409);
      await database.prepare("UPDATE reward_claims SET state = 'submitting', updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'claimable'")
        .bind(claim.id).run();
      let receipt: { signature: string; slot: number };
      try {
        receipt = await submitAndConfirmRewardPayout({
          transaction: signed,
          blockhash: intent.provider_request_id,
          lastValidBlockHeight: intent.last_valid_block_height,
        });
      } catch (error) {
        const status = await getMainnetConnection().getSignatureStatuses([expectedSignature], { searchTransactionHistory: true }).catch(() => null);
        const landed = status?.value[0] ?? null;
        if (landed && !landed.err) {
          receipt = { signature: expectedSignature, slot: landed.slot };
        } else {
          const knownFailure = Boolean(landed?.err);
          await database.batch([
            database.prepare("UPDATE transaction_intents SET state = ?2, tx_signature = ?3, error_code = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?1")
              .bind(intent.id, knownFailure ? "failed" : "submission_unknown", expectedSignature, knownFailure ? "reward_payout_failed" : "reward_payout_unknown"),
            database.prepare("UPDATE reward_claims SET state = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND state = 'submitting'")
              .bind(claim.id, knownFailure ? "claimable" : "submission_unknown"),
          ]);
          throw error;
        }
      }
      await recordConfirmedPayout(claim, intent.id, receipt);
      return privateJson({ ok: true, signature: receipt.signature, slot: receipt.slot, data: await getConsoleData() });
    }
    return privateJson({ error: "Unknown reward action." }, 400);
  } catch (error) {
    console.error("operator_reward_action_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: error instanceof Error ? error.message : "The reward action failed safely." }, 503);
  }
}
