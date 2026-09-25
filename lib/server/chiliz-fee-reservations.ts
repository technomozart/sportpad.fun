/** Accounting-only reservation of a finalized Pump distribution's entire
 * 80% SOL reward share. This module never prepares or broadcasts a swap. */

export type ChilizFeeReservation = {
  id: string;
  feeEventId: string;
  settlementId: string;
  launchId: string;
  rewardTreasury: string;
  sourceSignature: string;
  sourceSlot: number;
  grossAmountLamports: string;
  rewardAmountLamports: string;
  createdAt: string;
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

export const INSERT_CHILIZ_FEE_RESERVATION_SQL = `
  INSERT OR IGNORE INTO chiliz_fee_reservations
    (id, fee_event_id, settlement_id, launch_id, reward_treasury,
      source_signature, source_slot, gross_amount_lamports, reward_amount_lamports)
  SELECT ?1, f.id, s.id, l.id, ?4,
    f.source_signature, f.source_slot, f.gross_amount_atomic, s.reward_amount_atomic
  FROM fee_events f
  JOIN settlements s ON s.fee_event_id = f.id
  JOIN launch_drafts l ON l.id = f.launch_id
  WHERE f.id = ?2 AND l.id = ?3 AND l.mainnet_reward_treasury = ?4
`;

export const SELECT_CHILIZ_FEE_RESERVATION_SQL = `
  SELECT id, fee_event_id, settlement_id, launch_id, reward_treasury,
    source_signature, source_slot, gross_amount_lamports,
    reward_amount_lamports, created_at
  FROM chiliz_fee_reservations
  WHERE fee_event_id = ?1 AND launch_id = ?2 AND reward_treasury = ?3
  LIMIT 1
`;

function safeInput(value: string, field: string) {
  if (typeof value !== "string" || value.length < 4 || value.length > 160 ||
      value.trim() !== value) throw new Error(`chiliz_fee_reservation_${field}_invalid`);
  return value;
}

function reservation(row: ReservationRow): ChilizFeeReservation {
  return {
    id: row.id,
    feeEventId: row.fee_event_id,
    settlementId: row.settlement_id,
    launchId: row.launch_id,
    rewardTreasury: row.reward_treasury,
    sourceSignature: row.source_signature,
    sourceSlot: row.source_slot,
    grossAmountLamports: row.gross_amount_lamports,
    rewardAmountLamports: row.reward_amount_lamports,
    createdAt: row.created_at,
  };
}

/** A single INSERT is the atomic reservation point. DB constraints and
 * triggers reject unfinalized, non-Chiliz, already-spent or competing fee
 * sources, including a concurrent Solana reward batch. No caller-supplied
 * amount can enlarge the source share. Existing identical calls are harmless. */
export async function reserveChilizFeeShare(database: D1Database, input: {
  feeEventId: string;
  launchId: string;
  rewardTreasury: string;
}) {
  const feeEventId = safeInput(input.feeEventId, "event");
  const launchId = safeInput(input.launchId, "launch");
  const rewardTreasury = safeInput(input.rewardTreasury, "treasury");
  const values = [feeEventId, launchId, rewardTreasury] as const;
  const find = () => database.prepare(SELECT_CHILIZ_FEE_RESERVATION_SQL)
    .bind(...values).first<ReservationRow>();
  const prior = await find();
  if (prior) return { reservation: reservation(prior), created: false as const };
  const id = `chiliz:fee:${feeEventId}`;
  const result = await database.prepare(INSERT_CHILIZ_FEE_RESERVATION_SQL)
    .bind(id, ...values).run();
  const saved = await find();
  if (!saved) throw new Error("chiliz_fee_reservation_ineligible_or_conflict");
  if (saved.id !== id || saved.fee_event_id !== feeEventId ||
      saved.launch_id !== launchId || saved.reward_treasury !== rewardTreasury) {
    throw new Error("chiliz_fee_reservation_identity_conflict");
  }
  return { reservation: reservation(saved), created: Number(result.meta.changes ?? 0) === 1 };
}
