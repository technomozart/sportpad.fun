import "server-only";

import { env } from "cloudflare:workers";
import { PublicKey } from "@solana/web3.js";

import { accrueHolderPosition } from "@/lib/protocol/holder-rewards";
import {
  ASSERT_ONE_CHECKPOINT_SQL,
  ASSERT_POSITION_COUNT_SQL,
  ASSERT_STAGED_SNAPSHOT_SQL,
  COMMIT_HOLDER_CHECKPOINT_SQL,
  COMMIT_STAGED_HOLDER_POSITIONS_SQL,
  RECORD_HOLDER_SNAPSHOT_SQL,
  STAGE_HOLDER_POSITION_SQL,
} from "@/lib/protocol/holder-indexer-sql";
import { isCommunityLaunchFeeSource } from "@/lib/protocol/fee-policy";
import { bondingCurvePda, feeSharingConfigPda } from "@/lib/protocol/pump-devnet-verification";
import { readExecutionConfig } from "@/lib/server/execution-config";
import { fetchFinalizedTokenHolders } from "@/lib/server/providers/helius-holders";
import { acquireWorkerLease, releaseWorkerLease } from "./lease";

const WORKER = "holder_epoch_indexer";
const LEASE_KEY = "worker:holder-epoch-indexer";

export type HolderIndexerTrigger = "operator" | "scheduled" | "internal";

type EpochRow = {
  epoch_id: string;
  launch_id: string;
  starts_at: string;
  ends_at: string;
  mainnet_mint: string;
  mainnet_creator_wallet: string | null;
  mainnet_reward_treasury: string;
  mainnet_buyback_treasury: string;
};

type PositionRow = {
  wallet: string;
  token_seconds_atomic: string;
  ending_balance_atomic: string;
  last_observed_at: number | null;
};

function unixSeconds(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Reward epoch timestamps are invalid.");
  return Math.floor(parsed / 1000);
}

async function writeBatches(database: D1Database, statements: D1PreparedStatement[], size = 75) {
  let changed = 0;
  for (let offset = 0; offset < statements.length; offset += size) {
    const results = await database.batch(statements.slice(offset, offset + size));
    changed += results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
  }
  return changed;
}

async function indexEpoch(database: D1Database, epoch: EpochRow) {
  // A terminated worker may leave an unfinished stage. Such rows are never
  // read by allocation and can be safely reclaimed after a day.
  await database.prepare("DELETE FROM holder_snapshot_staging WHERE created_at < datetime('now', '-1 day')").run();
  const mint = new PublicKey(epoch.mainnet_mint);
  const excluded = new Set([
    epoch.mainnet_creator_wallet,
    epoch.mainnet_reward_treasury,
    epoch.mainnet_buyback_treasury,
    bondingCurvePda(mint).toBase58(),
    feeSharingConfigPda(mint).toBase58(),
    PublicKey.default.toBase58(),
  ].filter((value): value is string => Boolean(value)));
  const snapshot = await fetchFinalizedTokenHolders({ mintAddress: mint.toBase58(), excludedWallets: excluded });
  // Read the base generation before positions. If another indexer commits
  // while this run stages, the final checkpoint compare-and-swap rejects the
  // stale accrual even when its slot and wall-clock time are later.
  const baseCheckpoint = await database.prepare(`
    SELECT generation_id FROM holder_snapshot_checkpoints WHERE epoch_id = ?1
  `).bind(epoch.epoch_id).first<{ generation_id: string }>();
  const existingResult = await database.prepare(`
    SELECT wallet, token_seconds_atomic, ending_balance_atomic, last_observed_at
    FROM holder_epoch_positions WHERE epoch_id = ?1
  `).bind(epoch.epoch_id).all<PositionRow>();
  const existing = new Map(existingResult.results.map((row) => [row.wallet, row]));
  const wallets = new Set([...existing.keys(), ...snapshot.balances.keys()]);
  const observedAt = Math.floor(Date.now() / 1000);
  const startsAt = unixSeconds(epoch.starts_at);
  const endsAt = unixSeconds(epoch.ends_at);
  const checkpointAt = Math.min(Math.max(observedAt, startsAt), endsAt);
  const generationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];

  for (const wallet of wallets) {
    const previous = existing.get(wallet);
    const next = accrueHolderPosition({
      previous: previous ? {
        tokenSecondsAtomic: BigInt(previous.token_seconds_atomic),
        endingBalanceAtomic: BigInt(previous.ending_balance_atomic),
        lastObservedAt: previous.last_observed_at,
      } : null,
      nextBalanceAtomic: snapshot.balances.get(wallet) ?? 0n,
      observedAt,
      startsAt,
      endsAt,
    });
    statements.push(database.prepare(STAGE_HOLDER_POSITION_SQL).bind(
      generationId,
      epoch.epoch_id,
      epoch.launch_id,
      wallet,
      next.tokenSecondsAtomic.toString(),
      next.endingBalanceAtomic.toString(),
      snapshot.slot,
      next.lastObservedAt,
    ));
  }
  try {
    const staged = await writeBatches(database, statements);
    if (staged !== wallets.size) throw new Error("holder_snapshot_stage_incomplete");
    const eventId = `holder-snapshot:${epoch.epoch_id}:${snapshot.slot}:${checkpointAt}`;
    // D1.batch is a transaction. A failed count, stale checkpoint, or failed
    // canonical copy rolls back the entire generation, including its event.
    const results = await database.batch([
      database.prepare(ASSERT_STAGED_SNAPSHOT_SQL).bind(generationId, epoch.epoch_id, wallets.size),
      database.prepare(COMMIT_HOLDER_CHECKPOINT_SQL).bind(
        epoch.epoch_id, generationId, snapshot.slot, checkpointAt, wallets.size, snapshot.evidenceHash,
        baseCheckpoint?.generation_id ?? null,
      ),
      database.prepare(ASSERT_ONE_CHECKPOINT_SQL),
      database.prepare(COMMIT_STAGED_HOLDER_POSITIONS_SQL).bind(generationId, epoch.epoch_id),
      database.prepare(ASSERT_POSITION_COUNT_SQL).bind(wallets.size),
      database.prepare(RECORD_HOLDER_SNAPSHOT_SQL).bind(
        eventId, epoch.epoch_id, snapshot.slot, String(snapshot.balances.size),
        epoch.mainnet_mint, snapshot.evidenceHash, generationId,
      ),
      database.prepare(ASSERT_ONE_CHECKPOINT_SQL),
    ]);
    const changed = Number(results[3].meta.changes ?? 0);
    return { accountsSeen: snapshot.accountsSeen, holders: snapshot.balances.size, changed, slot: snapshot.slot };
  } finally {
    await database.prepare("DELETE FROM holder_snapshot_staging WHERE generation_id = ?1")
      .bind(generationId).run();
  }
}

async function activeEpochs(database: D1Database, epochId?: string) {
  const filter = epochId ? "AND e.id = ?1" : "";
  return database.prepare(`
    SELECT e.id AS epoch_id, e.launch_id, e.starts_at, e.ends_at,
      l.mainnet_mint, l.mainnet_creator_wallet,
      l.mainnet_reward_treasury, l.mainnet_buyback_treasury
    FROM reward_epochs e
    JOIN launch_drafts l ON l.id = e.launch_id
    WHERE e.state = 'accruing'
      AND l.status = 'mainnet_published'
      AND l.mainnet_mint IS NOT NULL
      AND l.mainnet_reward_treasury IS NOT NULL
      AND l.mainnet_buyback_treasury IS NOT NULL
      ${filter}
    ORDER BY e.created_at
    LIMIT 50
  `).bind(...(epochId ? [epochId] : [])).all<EpochRow>();
}

export async function runHolderIndexer(trigger: HolderIndexerTrigger, epochId?: string) {
  if (!env.DB) throw new Error("D1 binding `DB` is unavailable.");
  const execution = readExecutionConfig();
  if (!execution.flags.holderIndexerEnabled && trigger !== "operator") {
    throw new Error("Holder indexer is disabled.");
  }
  const owner = crypto.randomUUID();
  if (!(await acquireWorkerLease({ database: env.DB, key: LEASE_KEY, owner, ttlSeconds: 90 }))) {
    return { skipped: true, reason: "lease_held" as const };
  }
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO worker_runs (id, worker, \"trigger\", state) VALUES (?1, ?2, ?3, 'running')")
    .bind(runId, WORKER, trigger).run();
  try {
    const epochs = await activeEpochs(env.DB, epochId);
    const communityEpochs = epochs.results.filter((epoch) =>
      isCommunityLaunchFeeSource(epoch.mainnet_mint, execution.mainnet.sportpadMint));
    let itemsSeen = 0;
    let itemsChanged = 0;
    const results = [];
    for (const epoch of communityEpochs) {
      const result = await indexEpoch(env.DB, epoch);
      itemsSeen += result.accountsSeen;
      itemsChanged += result.changed;
      results.push({ epochId: epoch.epoch_id, ...result });
    }
    await env.DB.prepare(`
      UPDATE worker_runs SET state = 'succeeded', items_seen = ?2, items_changed = ?3,
        completed_at = CURRENT_TIMESTAMP WHERE id = ?1
    `).bind(runId, itemsSeen, itemsChanged).run();
    return { skipped: false, runId, epochs: results };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE worker_runs SET state = 'failed', error_code = 'holder_indexer_failed',
        completed_at = CURRENT_TIMESTAMP WHERE id = ?1
    `).bind(runId).run();
    throw error;
  } finally {
    await releaseWorkerLease(env.DB, LEASE_KEY, owner);
  }
}
