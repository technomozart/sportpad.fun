import { feeEventId } from "../../../../../lib/protocol/accounting.ts";
import {
  SELECT_CHILIZ_FEE_RESERVATION_SQL,
  type ChilizFeeReservation,
} from "../../../../../lib/server/chiliz-fee-reservations.ts";
import { nextChilizSolChzSwapChunk } from
  "../../../../../lib/server/chiliz-sol-chz-swap-journal.ts";

const MAX_FEE_LAMPORTS = 1_000_000_000_000_000n;
const MIN_STANDALONE_REWARD_LAMPORTS = 1_000_000n;
const MAX_SWAP_CHUNK_LAMPORTS = 100_000_000n;

type FeeRow = {
  fee_event_id: string;
  settlement_id: string;
  launch_id: string;
  source_signature: string;
  instruction_index: number;
  source_slot: number;
  gross_amount_atomic: string;
  reward_amount_atomic: string;
  buyback_amount_atomic: string;
  reward_treasury: string;
};

type ReservationRow = {
  id: string;
  fee_event_id: string;
  settlement_id: string;
  launch_id: string;
  reward_treasury: string;
  source_signature: string;
  source_slot: number;
  gross_amount_lamports: string;
  reward_amount_lamports: string;
  created_at: string;
};

export type FundingInspection = {
  feeEventId: string;
  launchId: string;
  settlementId: string;
  sourceSignature: string;
  sourceSlot: number;
  rewardTreasury: string;
  grossAmountLamports: string;
  rewardAmountLamports: string;
  buybackAmountLamports: string;
  reservation: ChilizFeeReservation | null;
  nextChunk: { sequence: number; attempt: number; offsetLamports: string;
    inputLamports: string } | null;
  blockedReason: "prior_chunk_unresolved" | "retry_budget_exhausted" | null;
  journal: Array<{ id: string; chunkSequence: number; attemptSequence: number;
    inputAmountLamports: string; state: string; sourceSignature: string }>;
};

function positive(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("fee_funding_amount_invalid");
  return BigInt(value);
}

function mapReservation(row: ReservationRow): ChilizFeeReservation {
  return { id: row.id, feeEventId: row.fee_event_id,
    settlementId: row.settlement_id, launchId: row.launch_id,
    rewardTreasury: row.reward_treasury, sourceSignature: row.source_signature,
    sourceSlot: row.source_slot, grossAmountLamports: row.gross_amount_lamports,
    rewardAmountLamports: row.reward_amount_lamports, createdAt: row.created_at };
}

/** Fee-indexer wrote this evidence only after finalized RPC plus decoded Pump
 * distribution checks. This endpoint rechecks its exact ledger identity and
 * leaves the database's reservation trigger as the authoritative write CAS. */
export async function inspectFeeFunding(database: D1Database, input: {
  feeEventId: string; launchId: string; rewardTreasury: string;
  sportpadMint: string | null;
}): Promise<FundingInspection> {
  const row = await database.prepare(`
    SELECT f.id AS fee_event_id, s.id AS settlement_id, l.id AS launch_id,
      f.source_signature, f.instruction_index, f.source_slot,
      f.gross_amount_atomic, s.reward_amount_atomic, s.buyback_amount_atomic,
      l.mainnet_reward_treasury AS reward_treasury
    FROM fee_events f
    JOIN settlements s ON s.fee_event_id = f.id
    JOIN launch_drafts l ON l.id = f.launch_id
    JOIN protocol_events proof ON proof.id = 'fee:' || f.id
    LEFT JOIN protocol_settings platform ON platform.key = 'sportpad_mint'
    WHERE f.id = ?1 AND l.id = ?2 AND l.mainnet_reward_treasury = ?3
      AND l.reward_chain = 'chiliz' AND l.reward_bps = 8000
      AND l.buyback_bps = 2000 AND l.status = 'mainnet_published'
      AND l.mainnet_verified_at IS NOT NULL AND l.mainnet_mint IS NOT NULL
      AND l.mainnet_fee_slot IS NOT NULL AND f.source_slot > l.mainnet_fee_slot
      AND (?4 IS NULL OR l.mainnet_mint <> ?4)
      AND (platform.value IS NULL OR l.mainnet_mint <> platform.value)
      AND f.state = 'reconciled'
      AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
      AND s.reward_spent_atomic = '0' AND s.reward_swap_signature IS NULL
      AND proof.idempotency_key = proof.id AND proof.category = 'fees'
      AND proof.entity_type = 'launch' AND proof.entity_id = l.id
      AND proof.event_type = 'pump_fee_distributed' AND proof.state = 'verified'
      AND proof.signature = f.source_signature AND proof.slot = f.source_slot
      AND proof.amount_atomic = f.gross_amount_atomic AND proof.mint = l.mainnet_mint
    LIMIT 1
  `).bind(input.feeEventId, input.launchId, input.rewardTreasury,
    input.sportpadMint).first<FeeRow>();
  if (!row || row.fee_event_id !== feeEventId(row.source_signature, row.instruction_index) ||
      !Number.isSafeInteger(row.source_slot) || row.source_slot <= 0) {
    throw new Error("fee_funding_finalized_source_unverified");
  }
  const gross = positive(row.gross_amount_atomic);
  const reward = positive(row.reward_amount_atomic);
  const buyback = positive(row.buyback_amount_atomic);
  if (gross > MAX_FEE_LAMPORTS || reward < MIN_STANDALONE_REWARD_LAMPORTS ||
      reward !== gross * 4n / 5n || buyback !== gross - reward) {
    throw new Error("fee_funding_split_or_minimum_invalid");
  }
  const saved = await database.prepare(SELECT_CHILIZ_FEE_RESERVATION_SQL)
    .bind(row.fee_event_id, row.launch_id, row.reward_treasury)
    .first<ReservationRow>();
  const reservation = saved ? mapReservation(saved) : null;
  let nextChunk: FundingInspection["nextChunk"] = null;
  let blockedReason: FundingInspection["blockedReason"] = null;
  if (reservation) {
    try { nextChunk = await nextChilizSolChzSwapChunk(database, reservation); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.endsWith("prior_chunk_unresolved")) blockedReason = "prior_chunk_unresolved";
      else if (message.endsWith("retry_budget_exhausted")) blockedReason = "retry_budget_exhausted";
      else throw error;
    }
  } else {
    nextChunk = { sequence: 0, attempt: 0, offsetLamports: "0",
      inputLamports: (reward < MAX_SWAP_CHUNK_LAMPORTS ? reward : MAX_SWAP_CHUNK_LAMPORTS).toString() };
  }
  const journalRows = reservation ? await database.prepare(`
    SELECT id, chunk_sequence, attempt_sequence, input_amount_lamports,
      state, source_signature FROM chiliz_sol_chz_swap_journal
    WHERE reservation_id = ?1 ORDER BY chunk_sequence, attempt_sequence LIMIT 100
  `).bind(reservation.id).all<{ id: string; chunk_sequence: number; attempt_sequence: number;
    input_amount_lamports: string; state: string; source_signature: string }>() : { results: [] };
  return {
    feeEventId: row.fee_event_id, launchId: row.launch_id,
    settlementId: row.settlement_id, sourceSignature: row.source_signature,
    sourceSlot: row.source_slot, rewardTreasury: row.reward_treasury,
    grossAmountLamports: gross.toString(), rewardAmountLamports: reward.toString(),
    buybackAmountLamports: buyback.toString(), reservation, nextChunk,
    blockedReason, journal: journalRows.results.map((item) => ({
      id: item.id, chunkSequence: item.chunk_sequence, attemptSequence: item.attempt_sequence,
      inputAmountLamports: item.input_amount_lamports, state: item.state,
      sourceSignature: item.source_signature,
    })),
  };
}
