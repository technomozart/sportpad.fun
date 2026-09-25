import type { AfcBuyCanaryIntent } from "./providers/chiliz-v2-buy-canary-intent.ts";

/** A single row with id `initial` may ever exist. No reward job, launch,
 * repeatable bridge credit, or fee-ledger row is linked to this canary. */
export const INSERT_AFC_BUY_CANARY_SQL = `
  INSERT INTO chiliz_afc_v2_buy_canary
    (id, treasury_address, fan_token_contract, amount_in_wei,
      minimum_output_atomic, nonce, deadline_epoch_seconds,
      maximum_network_fee_wei, tx_hash, raw_transaction, intent_json)
  VALUES ('initial', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
`;

export const SELECT_AFC_BUY_CANARY_SQL = `
  SELECT * FROM chiliz_afc_v2_buy_canary WHERE id = 'initial' LIMIT 1
`;

/** Durable one-way marker; must change exactly one row before sendRawTransaction. */
export const MARK_AFC_BUY_CANARY_BROADCAST_SQL = `
  UPDATE chiliz_afc_v2_buy_canary SET state = 'broadcast_attempted',
    broadcast_attempted_at_ms = ?2, updated_at = CURRENT_TIMESTAMP
  WHERE id = 'initial' AND tx_hash = ?1 AND state = 'prepared'
    AND broadcast_attempted_at_ms IS NULL AND ?2 > 0
`;

/** Bind only a dual-RPC validator-finalized receipt and verified AFC output.
 * A finalized revert records zero output and still consumes the one shot. */
export const FINALIZE_AFC_BUY_CANARY_SQL = `
  UPDATE chiliz_afc_v2_buy_canary SET state = ?2,
    receipt_status = ?3, receipt_block_hash = ?4,
    receipt_block_number = ?5, finalized_block_number = ?6,
    output_amount_atomic = ?7, receipt_evidence_json = ?8,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = 'initial' AND tx_hash = ?1 AND state = 'broadcast_attempted'
    AND broadcast_attempted_at_ms IS NOT NULL
    AND ((?2 = 'finalized_success' AND ?3 = 'success'
        AND ?7 GLOB '[1-9]*' AND ?7 NOT GLOB '*[^0-9]*'
        AND (length(?7) > length(minimum_output_atomic) OR
          (length(?7) = length(minimum_output_atomic) AND ?7 >= minimum_output_atomic))) OR
         (?2 = 'finalized_reverted' AND ?3 = 'reverted' AND ?7 = '0'))
    AND ?5 > 0 AND ?6 >= ?5
    AND length(?4) = 66 AND substr(?4,1,2) = '0x'
    AND substr(?4,3) NOT GLOB '*[^0-9a-f]*'
    AND json_valid(?8) AND json_type(?8) = 'object'
    AND json_extract(?8, '$.txHash') = tx_hash
    AND json_extract(?8, '$.receiptStatus') = ?3
    AND json_extract(?8, '$.receiptBlockHash') = ?4
    AND json_extract(?8, '$.receiptBlockNumber') = ?5
    AND json_extract(?8, '$.finalizedBlockNumber') = ?6
    AND json_extract(?8, '$.outputAmountAtomic') = ?7
`;

export function afcBuyCanaryInsertBindings(intent: AfcBuyCanaryIntent) {
  return [intent.treasury.toLowerCase(), intent.fanTokenContract.toLowerCase(),
    intent.valueWei, intent.minimumOutputAtomic, intent.nonce,
    intent.deadlineEpochSeconds, intent.maximumNetworkFeeWei,
    intent.txHash.toLowerCase(), intent.rawTransaction.toLowerCase(),
    JSON.stringify(intent)] as const;
}
