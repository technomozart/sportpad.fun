import { reconcileChilizSignedIntent, verifyPersistedChilizSignedIntent,
  type ChilizReconciliationEvidence, type ChilizSignedIntent } from "../protocol/chiliz-signed-intent.ts";

/** No policy row is seeded. Bind job ID and canonical decimal wei cap; the
 * job type selects its only possible slot. Purchase <=9 CHZ, claim <=1 CHZ,
 * including network fees. Neither slot can be created a second time. */
export const INSERT_PAUSED_CHILIZ_INTENT_POLICY_SQL = `
  INSERT INTO chiliz_intent_policy (key, authorized_job_id, max_total_spend_wei)
  SELECT CASE WHEN j.job_type = 'chiliz_reward_purchase'
    THEN 'purchase_canary' ELSE 'claim_canary' END, j.id, ?2
  FROM automation_jobs j
  WHERE j.id = ?1 AND j.chain = 'chiliz'
    AND j.job_type IN ('chiliz_reward_purchase', 'chiliz_claim_unwrap')
    AND ?2 GLOB '[1-9]*' AND ?2 NOT GLOB '*[^0-9]*'
    AND (length(?2) < 19 OR (length(?2) = 19 AND
      ((j.job_type = 'chiliz_reward_purchase' AND ?2 <= '9000000000000000000') OR
       (j.job_type = 'chiliz_claim_unwrap' AND ?2 <= '1000000000000000000'))))
`;

/** Arming does not sign or transmit anything. A prior reservation is permanent
 * even if the policy is paused afterwards; it cannot be armed a second time. */
export const ARM_CHILIZ_INTENT_POLICY_SQL = `
  UPDATE chiliz_intent_policy SET state = 'armed', updated_at = CURRENT_TIMESTAMP
  WHERE authorized_job_id = ?1 AND state = 'paused'
    AND reserved_intent_id IS NULL
    AND EXISTS (SELECT 1 FROM automation_jobs j WHERE j.id = ?1 AND j.chain = 'chiliz'
      AND ((chiliz_intent_policy.key = 'purchase_canary' AND
        j.job_type = 'chiliz_reward_purchase') OR
        (chiliz_intent_policy.key = 'claim_canary' AND
        j.job_type = 'chiliz_claim_unwrap')))
`;

export const PAUSE_CHILIZ_INTENT_POLICY_SQL = `
  UPDATE chiliz_intent_policy SET state = 'paused', updated_at = CURRENT_TIMESTAMP
  WHERE state IN ('armed', 'reserved')
`;

/** Bind the tuple from chilizSignedIntentInsertBindings. The row, one-row
 * assertion, policy reservation, and second assertion must share one D1 batch
 * before *any* sendRawTransaction call. A zero-row insert is a hard failure.
 * There is deliberately no INSERT OR REPLACE, UPSERT, or nonce substitution. */
export const INSERT_CHILIZ_SIGNED_INTENT_SQL = `
  INSERT INTO chiliz_signed_intents
    (id, job_id, attempt, chain_id, treasury_address, nonce, kind,
      fan_token_contract, tx_hash, raw_transaction, intent_json,
      maximum_principal_wei, maximum_network_fee_wei, maximum_total_spend_wei)
  SELECT ?1, j.id, ?3, 88888, ?4, ?5, ?6,
    ?7, ?8, ?9, ?10, ?11, ?12, ?13
  FROM automation_jobs j JOIN chiliz_intent_policy p
    ON p.authorized_job_id = j.id
  WHERE j.id = ?2 AND j.chain = 'chiliz' AND j.state = 'broadcasting'
    AND j.attempt = ?3
    AND j.error_code = 'broadcasting:' || ?14
    AND p.state = 'armed' AND p.reserved_intent_id IS NULL
    AND (length(?13) < length(p.max_total_spend_wei) OR
      (length(?13) = length(p.max_total_spend_wei) AND ?13 <= p.max_total_spend_wei))
    AND ((?6 = 'purchase' AND j.job_type = 'chiliz_reward_purchase' AND
        p.key = 'purchase_canary') OR
         (?6 = 'claim' AND j.job_type = 'chiliz_claim_unwrap' AND
        p.key = 'claim_canary'))
    AND EXISTS (SELECT 1 FROM protocol_controls c WHERE c.key = 'global'
      AND c.rewards_paused = 0 AND (?6 = 'claim' OR c.settlement_paused = 0))
`;

/** Bind job ID and intent ID. Must be in the same D1 batch as INSERT and both
 * one-row assertions; otherwise an intent could be persisted without consuming
 * the one-shot authorization. */
export const RESERVE_CHILIZ_INTENT_POLICY_SQL = `
  UPDATE chiliz_intent_policy SET state = 'reserved', reserved_intent_id = ?2,
    updated_at = CURRENT_TIMESTAMP
  WHERE state = 'armed' AND authorized_job_id = ?1
    AND reserved_intent_id IS NULL
    AND EXISTS (SELECT 1 FROM chiliz_signed_intents i
      WHERE i.id = ?2 AND i.job_id = ?1 AND i.state = 'prepared'
        AND ((i.kind = 'purchase' AND chiliz_intent_policy.key = 'purchase_canary') OR
             (i.kind = 'claim' AND chiliz_intent_policy.key = 'claim_canary')))
`;

/** Never expose this row from a public route: raw_transaction is a signed
 * bearer-spend transaction. The internal route must authenticate first. */
export const SELECT_CHILIZ_SIGNED_INTENT_SQL = `
  SELECT i.* FROM chiliz_signed_intents i
  JOIN chiliz_intent_policy p ON p.authorized_job_id = i.job_id
    AND p.reserved_intent_id = i.id
    AND ((i.kind = 'purchase' AND p.key = 'purchase_canary') OR
         (i.kind = 'claim' AND p.key = 'claim_canary'))
  WHERE i.job_id = ?1 LIMIT 1
`;

/** Recovery for the one first-attempt Chiliz job that was armed but failed
 * before any signed transaction was durably prepared. Bind job ID, the exact
 * error code read from that same job, and next available time in milliseconds.
 * The authenticated route must separately match its worker ID to the
 * configured Chiliz treasury: the historical fail transition replaces the
 * broadcast-owner error code, so SQL cannot independently recover that ID.
 * Resetting attempt 1 to 0 lets the existing lease CAS issue attempt 1 again;
 * this is safe ONLY because the compliant worker never sends raw bytes before
 * the signed intent/policy reservation commits, and all receipt/hash/intent
 * evidence is absent. Any ambiguity remains held for human reconciliation. */
export const REQUEUE_UNPREPARED_CHILIZ_JOB_SQL = `
  UPDATE automation_jobs SET state = 'queued', attempt = 0,
    error_code = NULL, leased_until = NULL, available_at = ?3,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND chain = 'chiliz'
    AND job_type IN ('chiliz_reward_purchase', 'chiliz_claim_unwrap')
    AND state = 'reconciliation_required' AND attempt = 1
    AND error_code = ?2 AND ?2 IS NOT NULL
    AND tx_hash IS NULL AND leased_until IS NULL
    AND json_type(payload_json, '$.reconciliationReceipt') IS NULL
    AND updated_at < datetime('now', '-5 minutes')
    AND NOT EXISTS (SELECT 1 FROM chiliz_signed_intents i
      WHERE i.job_id = automation_jobs.id)
    AND EXISTS (SELECT 1 FROM chiliz_intent_policy p
      WHERE p.authorized_job_id = automation_jobs.id
        AND p.reserved_intent_id IS NULL
        AND ((p.key = 'purchase_canary' AND
          automation_jobs.job_type = 'chiliz_reward_purchase') OR
          (p.key = 'claim_canary' AND
          automation_jobs.job_type = 'chiliz_claim_unwrap')))
`;

/** A compliant worker may crash after ARM but before PREPARE. This separate
 * CAS retains the original broadcasting-owner fence (unlike the fail path).
 * Bind job ID, exact worker ID, and next available time in milliseconds.
 * It is never safe after a signed intent, hash, or receipt has appeared. */
export const REQUEUE_STALE_UNPREPARED_CHILIZ_BROADCAST_SQL = `
  UPDATE automation_jobs SET state = 'queued', attempt = 0,
    error_code = NULL, leased_until = NULL, available_at = ?3,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND chain = 'chiliz'
    AND job_type IN ('chiliz_reward_purchase', 'chiliz_claim_unwrap')
    AND state = 'broadcasting' AND attempt = 1
    AND error_code = 'broadcasting:' || ?2
    AND tx_hash IS NULL AND leased_until IS NULL
    AND json_type(payload_json, '$.reconciliationReceipt') IS NULL
    AND updated_at < datetime('now', '-5 minutes')
    AND NOT EXISTS (SELECT 1 FROM chiliz_signed_intents i
      WHERE i.job_id = automation_jobs.id)
    AND EXISTS (SELECT 1 FROM chiliz_intent_policy p
      WHERE p.authorized_job_id = automation_jobs.id
        AND p.reserved_intent_id IS NULL
        AND ((p.key = 'purchase_canary' AND
          automation_jobs.job_type = 'chiliz_reward_purchase') OR
          (p.key = 'claim_canary' AND
          automation_jobs.job_type = 'chiliz_claim_unwrap')))
`;

/** Mark before attempting network broadcast; a lost RPC response must only
 * trigger same-raw rebroadcast or receipt reconciliation. */
export const MARK_CHILIZ_INTENT_BROADCAST_SQL = `
  UPDATE chiliz_signed_intents SET state = 'broadcast_attempted',
    broadcast_attempted_at = ?3, updated_at = CURRENT_TIMESTAMP
  WHERE job_id = ?1 AND tx_hash = ?2 AND state = 'prepared'
    AND EXISTS (SELECT 1 FROM chiliz_intent_policy p
      WHERE p.authorized_job_id = ?1
        AND p.reserved_intent_id = chiliz_signed_intents.id
        AND p.state = 'reserved'
        AND ((p.key = 'purchase_canary' AND
          chiliz_signed_intents.kind = 'purchase') OR
          (p.key = 'claim_canary' AND chiliz_signed_intents.kind = 'claim')))
`;

/** Bind verified reconciliation output/evidence only after comparing the
 * canonical finalized block, transaction and receipt with the persisted raw.
 * This is a one-way transition; neither outcome permits a different tx. */
export const FINALIZE_CHILIZ_INTENT_SQL = `
  UPDATE chiliz_signed_intents SET
    state = ?3, receipt_status = ?4,
    receipt_block_hash = ?5, receipt_block_number = ?6,
    canonical_receipt_block_hash = ?7, finalized_block_number = ?8,
    gas_used = ?9, effective_gas_price_wei = ?10,
    network_fee_wei = ?11, principal_spent_wei = ?12,
    total_spent_wei = ?13, evidence_json = ?14,
    updated_at = CURRENT_TIMESTAMP
  WHERE job_id = ?1 AND tx_hash = ?2
    AND state IN ('prepared', 'broadcast_attempted')
    AND ((?3 = 'finalized_success' AND ?4 = 'success') OR
         (?3 = 'finalized_reverted' AND ?4 = 'reverted'))
    AND ?6 >= 0 AND ?8 >= ?6 AND ?5 = ?7
    AND EXISTS (SELECT 1 FROM chiliz_intent_policy p
      WHERE p.authorized_job_id = ?1
        AND p.reserved_intent_id = chiliz_signed_intents.id
        AND ((p.key = 'purchase_canary' AND
          chiliz_signed_intents.kind = 'purchase') OR
          (p.key = 'claim_canary' AND chiliz_signed_intents.kind = 'claim')))
`;

/** A validator-finalized revert consumes gas, never funds rewards. This job
 * transition must share one D1 batch with FINALIZE_CHILIZ_INTENT_SQL and both
 * one-row assertions. Its claim or settlement liability remains untouched. */
export const FINALIZE_REVERTED_CHILIZ_JOB_SQL = `
  UPDATE automation_jobs SET state = 'failed', tx_hash = ?2,
    error_code = 'chiliz_finalized_reverted', leased_until = NULL,
    payload_json = json_set(payload_json, '$.reconciliationReceipt', json(?3)),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?1 AND chain = 'chiliz'
    AND state IN ('broadcasting', 'reconciliation_required')
    AND (tx_hash IS NULL OR lower(tx_hash) = lower(?2))
    AND EXISTS (SELECT 1 FROM chiliz_signed_intents i
      WHERE i.job_id = automation_jobs.id AND i.tx_hash = lower(?2)
        AND i.state = 'finalized_reverted')
`;

export function chilizSignedIntentInsertBindings(intent: ChilizSignedIntent,
  workerId: string, id: string) {
  return [id, intent.jobId, intent.attempt, intent.treasury.toLowerCase(),
    intent.nonce, intent.kind, intent.fanTokenContract.toLowerCase(),
    intent.txHash.toLowerCase(), intent.rawTransaction.toLowerCase(),
    JSON.stringify(intent), intent.kind === "purchase" ? intent.maxPrincipalWei : "0",
    intent.maximumNetworkFeeWei, intent.maximumTotalSpendWei, workerId] as const;
}

export type PersistedChilizIntentRow = {
  id: string; job_id: string; attempt: number; chain_id: number;
  treasury_address: string; nonce: number; kind: string;
  fan_token_contract: string; tx_hash: string; raw_transaction: string;
  intent_json: string; maximum_principal_wei: string;
  maximum_network_fee_wei: string; maximum_total_spend_wei: string;
  state: string;
};

/** Re-derive the signed transaction and compare every duplicated indexed/cap
 * field. A corrupted row cannot be used as a recovery broadcast instruction. */
export async function parsePersistedChilizSignedIntent(row: PersistedChilizIntentRow):
  Promise<ChilizSignedIntent> {
  let parsed: ChilizSignedIntent;
  try { parsed = JSON.parse(row.intent_json) as ChilizSignedIntent; }
  catch { throw new Error("chiliz_intent_persisted_json_invalid"); }
  const intent = await verifyPersistedChilizSignedIntent(parsed);
  if (row.job_id !== intent.jobId || row.attempt !== intent.attempt || row.chain_id !== 88888 ||
      row.treasury_address !== intent.treasury.toLowerCase() || row.nonce !== intent.nonce ||
      row.kind !== intent.kind || row.fan_token_contract !== intent.fanTokenContract.toLowerCase() ||
      row.tx_hash !== intent.txHash.toLowerCase() ||
      row.raw_transaction !== intent.rawTransaction.toLowerCase() ||
      row.maximum_principal_wei !== (intent.kind === "purchase" ? intent.maxPrincipalWei : "0") ||
      row.maximum_network_fee_wei !== intent.maximumNetworkFeeWei ||
      row.maximum_total_spend_wei !== intent.maximumTotalSpendWei) {
    throw new Error("chiliz_intent_persisted_row_mismatch");
  }
  return intent;
}

/** Construct finalization bindings only from a fully verified canonical,
 * finalized receipt. This does not prove ERC-20 output delivery or settle a
 * reward ledger entry; a separate token-balance/log proof is still required. */
export async function chilizFinalizationBindings(intent: ChilizSignedIntent,
  evidence: ChilizReconciliationEvidence) {
  const result = await reconcileChilizSignedIntent(intent, evidence);
  if (result.state === "unresolved" || !evidence.receipt ||
      evidence.finalizedBlockNumber === null || evidence.finalizedBlockNumber === undefined ||
      !evidence.canonicalReceiptBlockHash) throw new Error("chiliz_intent_finality_unverified");
  const blockNumber = Number(evidence.receipt.blockNumber);
  const finalizedNumber = Number(evidence.finalizedBlockNumber);
  if (!Number.isSafeInteger(blockNumber) || !Number.isSafeInteger(finalizedNumber) ||
      blockNumber < 0 || finalizedNumber < blockNumber ||
      BigInt(result.totalSpentWei) > BigInt(intent.maximumTotalSpendWei)) {
    throw new Error("chiliz_intent_finality_invalid");
  }
  const receipt = evidence.receipt;
  const evidenceJson = JSON.stringify(evidence, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value);
  return [intent.jobId, intent.txHash.toLowerCase(), result.state,
    receipt.status, receipt.blockHash.toLowerCase(), blockNumber,
    evidence.canonicalReceiptBlockHash.toLowerCase(), finalizedNumber,
    receipt.gasUsed.toString(), receipt.effectiveGasPrice.toString(),
    result.networkFeeWei, result.principalSpentWei, result.totalSpentWei,
    evidenceJson] as const;
}
