CREATE TABLE `chiliz_v2_purchase_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`bridge_id` text NOT NULL,
	`allocation_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`fee_event_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`launch_id` text NOT NULL,
	`job_id` text NOT NULL,
	`destination_treasury` text NOT NULL,
	`destination_tx_hash` text NOT NULL,
	`destination_received_wei` text NOT NULL,
	`gas_reserve_wei` text NOT NULL,
	`state` text DEFAULT 'available' NOT NULL,
	`signed_intent_id` text,
	`actual_spent_wei` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`bridge_id`) REFERENCES `chiliz_bridge_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`allocation_id`) REFERENCES `chiliz_bridge_allocations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `chiliz_fee_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fee_event_id`) REFERENCES `fee_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `automation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_intent_id`) REFERENCES `chiliz_signed_intents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_v2_credit_state" CHECK("chiliz_v2_purchase_credits"."state" IN ('available','prepared','broadcast_unknown','finalized_success','finalized_reverted')),
	CONSTRAINT "chk_chiliz_v2_credit_received" CHECK("chiliz_v2_purchase_credits"."destination_received_wei" GLOB '[1-9]*' AND "chiliz_v2_purchase_credits"."destination_received_wei" NOT GLOB '*[^0-9]*' AND (length("chiliz_v2_purchase_credits"."destination_received_wei") < 19 OR (length("chiliz_v2_purchase_credits"."destination_received_wei") = 19 AND "chiliz_v2_purchase_credits"."destination_received_wei" <= '9000000000000000000'))),
	CONSTRAINT "chk_chiliz_v2_credit_reserve" CHECK("chiliz_v2_purchase_credits"."gas_reserve_wei" GLOB '[1-9]*' AND "chiliz_v2_purchase_credits"."gas_reserve_wei" NOT GLOB '*[^0-9]*' AND (length("chiliz_v2_purchase_credits"."gas_reserve_wei") < 18 OR (length("chiliz_v2_purchase_credits"."gas_reserve_wei") = 18 AND "chiliz_v2_purchase_credits"."gas_reserve_wei" BETWEEN '100000000000000000' AND '1000000000000000000')) AND CAST("chiliz_v2_purchase_credits"."gas_reserve_wei" AS INTEGER) >= 100000000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_bridge` ON `chiliz_v2_purchase_credits` (`bridge_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_allocation` ON `chiliz_v2_purchase_credits` (`allocation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_reservation` ON `chiliz_v2_purchase_credits` (`reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_event` ON `chiliz_v2_purchase_credits` (`fee_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_settlement` ON `chiliz_v2_purchase_credits` (`settlement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_job` ON `chiliz_v2_purchase_credits` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_destination_tx` ON `chiliz_v2_purchase_credits` (`destination_tx_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_v2_credit_intent` ON `chiliz_v2_purchase_credits` (`signed_intent_id`) WHERE "chiliz_v2_purchase_credits"."signed_intent_id" IS NOT NULL;
--> statement-breakpoint
-- Intentionally one fee, one complete SOL->CHZ swap, one complete OFT transfer.
-- This is a bounded canary, not a general multi-fee allocation algorithm.
CREATE TRIGGER `trg_chiliz_v2_credit_insert_verified` BEFORE INSERT
  ON `chiliz_v2_purchase_credits`
WHEN NEW.id <> 'chiliz:v2-credit:' || NEW.allocation_id
  OR NEW.state <> 'available' OR NEW.signed_intent_id IS NOT NULL
  OR NEW.actual_spent_wei IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM chiliz_bridge_transfers b
    JOIN chiliz_bridge_allocations a ON a.bridge_id = b.id
    JOIN chiliz_sol_chz_swap_journal swap ON swap.id = a.swap_intent_id
    JOIN chiliz_fee_reservations r ON r.id = a.reservation_id
    JOIN fee_events f ON f.id = r.fee_event_id
    JOIN settlements s ON s.id = r.settlement_id
    JOIN launch_drafts l ON l.id = r.launch_id
    JOIN automation_jobs j ON j.entity_id = s.id
    WHERE b.id = NEW.bridge_id AND a.id = NEW.allocation_id
      AND b.state = 'destination_finalized'
      AND b.destination_chain_id = 88888
      AND b.destination_tx_hash = NEW.destination_tx_hash
      AND b.destination_treasury = NEW.destination_treasury
      AND b.destination_received_wei = NEW.destination_received_wei
      AND b.destination_finalized_block > 0
      AND b.destination_evidence_json IS NOT NULL
      AND a.bridge_id = b.id AND a.swap_intent_id = swap.id
      AND a.reservation_id = r.id AND a.fee_event_id = f.id
      AND a.launch_id = l.id AND f.launch_id = l.id
      AND NEW.reservation_id = r.id AND NEW.fee_event_id = f.id
      AND NEW.settlement_id = s.id AND NEW.launch_id = l.id
      AND NEW.job_id = j.id
      AND r.reward_treasury = b.source_wallet
      AND swap.state = 'finalized_success'
      AND swap.reservation_id = r.id AND swap.chunk_sequence = 0
      AND swap.chunk_offset_lamports = '0'
      AND swap.input_amount_lamports = r.reward_amount_lamports
      AND CAST(r.reward_amount_lamports AS INTEGER) <= 100000000
      AND swap.output_amount_atomic = a.amount_atomic
      AND a.swap_output_offset_atomic = '0'
      AND a.amount_atomic = b.source_amount_atomic
      AND (SELECT COUNT(*) FROM chiliz_bridge_allocations other
        WHERE other.bridge_id = b.id) = 1
      AND (SELECT COUNT(*) FROM chiliz_sol_chz_swap_journal other
        WHERE other.reservation_id = r.id AND other.state = 'finalized_success') = 1
      AND s.fee_event_id = f.id AND s.reward_swap_signature IS NULL
      AND s.reward_spent_atomic = '0'
      AND s.state IN ('reconciled','distributed','buyback_burned')
      AND l.reward_chain = 'chiliz' AND l.reward_wrapped_contract IS NULL
      AND l.status = 'mainnet_published' AND l.reward_mint IS NOT NULL
      AND j.job_type = 'chiliz_reward_purchase'
      AND j.entity_type = 'settlement' AND j.chain = 'chiliz'
      AND j.state = 'queued' AND j.attempt = 0
      AND j.tx_hash IS NULL AND j.error_code IS NULL
      AND json_valid(j.payload_json)
      AND json_extract(j.payload_json,'$.settlementId') = s.id
      AND json_extract(j.payload_json,'$.launchId') = l.id
      AND json_extract(j.payload_json,'$.rewardAmountLamports') = r.reward_amount_lamports
      AND lower(json_extract(j.payload_json,'$.fanTokenContract')) = lower(l.reward_mint)
      AND CAST(NEW.gas_reserve_wei AS INTEGER) < CAST(NEW.destination_received_wei AS INTEGER)
      AND CAST(NEW.destination_received_wei AS INTEGER)
        - CAST(NEW.gas_reserve_wei AS INTEGER) <= 8000000000000000000
      AND (length(NEW.destination_received_wei) < length(a.amount_atomic || '0000000000')
        OR (length(NEW.destination_received_wei) = length(a.amount_atomic || '0000000000')
          AND NEW.destination_received_wei <= a.amount_atomic || '0000000000'))
  )
BEGIN SELECT RAISE(ABORT, 'chiliz_v2_credit_unbacked'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_v2_credit_no_delete` BEFORE DELETE
  ON `chiliz_v2_purchase_credits`
BEGIN SELECT RAISE(ABORT, 'chiliz_v2_credit_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_v2_credit_one_way` BEFORE UPDATE
  ON `chiliz_v2_purchase_credits`
WHEN NEW.id IS NOT OLD.id OR NEW.bridge_id IS NOT OLD.bridge_id
  OR NEW.allocation_id IS NOT OLD.allocation_id
  OR NEW.reservation_id IS NOT OLD.reservation_id
  OR NEW.fee_event_id IS NOT OLD.fee_event_id
  OR NEW.settlement_id IS NOT OLD.settlement_id
  OR NEW.launch_id IS NOT OLD.launch_id OR NEW.job_id IS NOT OLD.job_id
  OR NEW.destination_treasury IS NOT OLD.destination_treasury
  OR NEW.destination_tx_hash IS NOT OLD.destination_tx_hash
  OR NEW.destination_received_wei IS NOT OLD.destination_received_wei
  OR NEW.gas_reserve_wei IS NOT OLD.gas_reserve_wei
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT (
    (OLD.state = 'available' AND NEW.state = 'prepared'
      AND OLD.signed_intent_id IS NULL AND NEW.signed_intent_id IS NOT NULL
      AND NEW.actual_spent_wei IS NULL
      AND EXISTS (SELECT 1 FROM chiliz_signed_intents i
        WHERE i.id = NEW.signed_intent_id AND i.job_id = OLD.job_id
          AND i.kind = 'purchase' AND i.state = 'prepared'))
    OR (OLD.state = 'prepared' AND NEW.state = 'broadcast_unknown'
      AND NEW.signed_intent_id IS OLD.signed_intent_id
      AND NEW.actual_spent_wei IS NULL
      AND EXISTS (SELECT 1 FROM chiliz_signed_intents i
        WHERE i.id = OLD.signed_intent_id AND i.job_id = OLD.job_id
          AND i.state = 'broadcast_attempted'))
    OR (OLD.state = 'broadcast_unknown'
      AND NEW.state IN ('finalized_success','finalized_reverted')
      AND NEW.signed_intent_id IS OLD.signed_intent_id
      AND EXISTS (SELECT 1 FROM chiliz_signed_intents i
        WHERE i.id = OLD.signed_intent_id AND i.job_id = OLD.job_id
          AND i.state = NEW.state AND i.total_spent_wei = NEW.actual_spent_wei
          AND i.receipt_status = CASE NEW.state WHEN 'finalized_success'
            THEN 'success' ELSE 'reverted' END
          AND i.total_spent_wei GLOB '[0-9]*'
          AND i.total_spent_wei NOT GLOB '*[^0-9]*'
          AND CAST(i.total_spent_wei AS INTEGER)
            <= CAST(OLD.destination_received_wei AS INTEGER)
              - CAST(OLD.gas_reserve_wei AS INTEGER)))
  )
BEGIN SELECT RAISE(ABORT, 'chiliz_v2_credit_invalid_transition'); END;
--> statement-breakpoint
-- A purchase signed intent without one exact fee-backed credit is forbidden,
-- including through the old API path. The fee's entire spendable credit must
-- be used in one bounded buy (within a 2% gas/slippage tolerance).
CREATE TRIGGER `trg_chiliz_v2_purchase_intent_funding` BEFORE INSERT
  ON `chiliz_signed_intents`
WHEN NEW.kind = 'purchase' AND NOT EXISTS (
  SELECT 1 FROM chiliz_v2_purchase_credits c
  JOIN launch_drafts l ON l.id = c.launch_id
  JOIN automation_jobs j ON j.id = c.job_id
  WHERE c.job_id = NEW.job_id AND c.state = 'available'
    AND c.signed_intent_id IS NULL AND c.actual_spent_wei IS NULL
    AND j.state = 'broadcasting' AND j.attempt = 1
    AND j.job_type = 'chiliz_reward_purchase'
    AND j.entity_type = 'settlement' AND j.entity_id = c.settlement_id
    AND NEW.state = 'prepared' AND NEW.attempt = 1 AND NEW.chain_id = 88888
    AND NEW.broadcast_attempted_at IS NULL AND NEW.receipt_status IS NULL
    AND NEW.evidence_json IS NULL
    AND NEW.treasury_address = c.destination_treasury
    AND NEW.fan_token_contract = lower(l.reward_mint)
    AND NEW.maximum_total_spend_wei GLOB '[1-9]*'
    AND NEW.maximum_total_spend_wei NOT GLOB '*[^0-9]*'
    AND NEW.maximum_principal_wei GLOB '[1-9]*'
    AND NEW.maximum_principal_wei NOT GLOB '*[^0-9]*'
    AND NEW.maximum_network_fee_wei GLOB '[1-9]*'
    AND NEW.maximum_network_fee_wei NOT GLOB '*[^0-9]*'
    AND CAST(NEW.maximum_total_spend_wei AS INTEGER) <= 8000000000000000000
    AND CAST(NEW.maximum_principal_wei AS INTEGER)
      + CAST(NEW.maximum_network_fee_wei AS INTEGER)
      = CAST(NEW.maximum_total_spend_wei AS INTEGER)
    AND CAST(NEW.maximum_network_fee_wei AS INTEGER)
      <= CAST(c.gas_reserve_wei AS INTEGER)
    AND CAST(NEW.maximum_total_spend_wei AS INTEGER)
      + CAST(c.gas_reserve_wei AS INTEGER)
      <= CAST(c.destination_received_wei AS INTEGER)
    AND CAST(NEW.maximum_total_spend_wei AS INTEGER)
      >= (CAST(c.destination_received_wei AS INTEGER)
        - CAST(c.gas_reserve_wei AS INTEGER))
        - (CAST(c.destination_received_wei AS INTEGER)
          - CAST(c.gas_reserve_wei AS INTEGER)) / 50
)
BEGIN SELECT RAISE(ABORT, 'chiliz_v2_purchase_unfunded'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_v2_purchase_intent_reserve` AFTER INSERT
  ON `chiliz_signed_intents`
WHEN NEW.kind = 'purchase'
BEGIN
  UPDATE chiliz_v2_purchase_credits SET state = 'prepared',
    signed_intent_id = NEW.id, updated_at = CURRENT_TIMESTAMP
  WHERE job_id = NEW.job_id AND state = 'available'
    AND signed_intent_id IS NULL;
  SELECT CASE WHEN changes() = 1 THEN 1
    ELSE RAISE(ABORT, 'chiliz_v2_purchase_credit_not_reserved') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_v2_purchase_intent_transition` BEFORE UPDATE OF state
  ON `chiliz_signed_intents`
WHEN OLD.kind = 'purchase' AND NOT EXISTS (
  SELECT 1 FROM chiliz_v2_purchase_credits c
  WHERE c.signed_intent_id = OLD.id AND c.job_id = OLD.job_id
    AND ((OLD.state = 'prepared' AND NEW.state = 'broadcast_attempted'
      AND c.state = 'prepared')
      OR (OLD.state = 'broadcast_attempted'
        AND NEW.state IN ('finalized_success','finalized_reverted')
        AND c.state = 'broadcast_unknown'))
)
BEGIN SELECT RAISE(ABORT, 'chiliz_v2_purchase_intent_invalid_transition'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_v2_purchase_intent_sync` AFTER UPDATE OF state
  ON `chiliz_signed_intents`
WHEN OLD.kind = 'purchase'
BEGIN
  UPDATE chiliz_v2_purchase_credits SET
    state = CASE NEW.state
      WHEN 'broadcast_attempted' THEN 'broadcast_unknown'
      ELSE NEW.state END,
    actual_spent_wei = CASE NEW.state
      WHEN 'broadcast_attempted' THEN NULL ELSE NEW.total_spent_wei END,
    updated_at = CURRENT_TIMESTAMP
  WHERE signed_intent_id = NEW.id AND job_id = NEW.job_id;
  SELECT CASE WHEN changes() = 1 THEN 1
    ELSE RAISE(ABORT, 'chiliz_v2_purchase_credit_not_synced') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_v2_purchase_job_identity` BEFORE UPDATE OF
  job_type, entity_type, entity_id, chain ON `automation_jobs`
WHEN EXISTS (SELECT 1 FROM chiliz_v2_purchase_credits c WHERE c.job_id = OLD.id)
  AND (NEW.job_type IS NOT OLD.job_type OR NEW.entity_type IS NOT OLD.entity_type
    OR NEW.entity_id IS NOT OLD.entity_id OR NEW.chain IS NOT OLD.chain)
BEGIN SELECT RAISE(ABORT, 'chiliz_v2_purchase_job_immutable'); END;
--> statement-breakpoint
-- 0027 forbade any reward signature once SOL was reserved. Permit only the
-- exact finalized Chiliz buy, never a Solana reward swap or spent-SOL rewrite.
DROP TRIGGER `trg_chiliz_fee_reservation_no_reward_progress`;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_reward_progress` BEFORE UPDATE OF
  reward_spent_atomic, reward_swap_signature ON `settlements`
WHEN EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = OLD.id)
  AND (NEW.reward_spent_atomic <> OLD.reward_spent_atomic
    OR (NEW.reward_swap_signature IS NOT OLD.reward_swap_signature
      AND NOT (OLD.reward_swap_signature IS NULL
        AND NEW.reward_swap_signature IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM chiliz_v2_purchase_credits c
          JOIN chiliz_signed_intents i ON i.id = c.signed_intent_id
          JOIN automation_jobs j ON j.id = c.job_id
          WHERE c.settlement_id = OLD.id
            AND c.state = 'finalized_success'
            AND i.state = 'finalized_success' AND i.receipt_status = 'success'
            AND i.tx_hash = NEW.reward_swap_signature
            AND i.job_id = j.id AND j.state = 'complete'
            AND j.tx_hash = i.tx_hash
            AND c.actual_spent_wei = i.total_spent_wei
        ))))
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
