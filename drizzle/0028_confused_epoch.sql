CREATE TABLE `chiliz_sol_chz_swap_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`chunk_sequence` integer NOT NULL,
	`attempt_sequence` integer NOT NULL,
	`chunk_offset_lamports` text NOT NULL,
	`source_wallet` text NOT NULL,
	`input_mint` text NOT NULL,
	`output_mint` text NOT NULL,
	`output_token_program` text NOT NULL,
	`output_ata` text NOT NULL,
	`input_amount_lamports` text NOT NULL,
	`minimum_output_atomic` text NOT NULL,
	`provider_request_id` text NOT NULL,
	`last_valid_block_height` integer NOT NULL,
	`unsigned_transaction_base64` text NOT NULL,
	`signed_transaction_base64` text NOT NULL,
	`signed_transaction_sha256` text NOT NULL,
	`transaction_message_hash` text NOT NULL,
	`source_signature` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`broadcast_attempted_at_ms` integer,
	`expiry_finalized_block_height` integer,
	`finalized_slot` integer,
	`source_balance_before_lamports` text,
	`source_balance_after_lamports` text,
	`output_balance_before_atomic` text,
	`output_balance_after_atomic` text,
	`output_amount_atomic` text,
	`receipt_error_code` text,
	`receipt_evidence_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `chiliz_fee_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_sol_chz_swap_input_mint" CHECK("chiliz_sol_chz_swap_journal"."input_mint" = 'So11111111111111111111111111111111111111112'),
	CONSTRAINT "chk_chiliz_sol_chz_swap_output_mint" CHECK("chiliz_sol_chz_swap_journal"."output_mint" = '6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw'),
	CONSTRAINT "chk_chiliz_sol_chz_swap_state" CHECK("chiliz_sol_chz_swap_journal"."state" IN ('prepared', 'expired_unbroadcast', 'broadcast_unknown', 'finalized_success', 'finalized_failure')),
	CONSTRAINT "chk_chiliz_sol_chz_swap_input" CHECK("chiliz_sol_chz_swap_journal"."input_amount_lamports" GLOB '[1-9]*' AND "chiliz_sol_chz_swap_journal"."input_amount_lamports" NOT GLOB '*[^0-9]*' AND (length("chiliz_sol_chz_swap_journal"."input_amount_lamports") < 9 OR (length("chiliz_sol_chz_swap_journal"."input_amount_lamports") = 9 AND "chiliz_sol_chz_swap_journal"."input_amount_lamports" <= '100000000'))),
	CONSTRAINT "chk_chiliz_sol_chz_swap_minimum" CHECK("chiliz_sol_chz_swap_journal"."minimum_output_atomic" GLOB '[1-9]*' AND "chiliz_sol_chz_swap_journal"."minimum_output_atomic" NOT GLOB '*[^0-9]*' AND length("chiliz_sol_chz_swap_journal"."minimum_output_atomic") <= 18),
	CONSTRAINT "chk_chiliz_sol_chz_swap_block_height" CHECK("chiliz_sol_chz_swap_journal"."last_valid_block_height" > 0),
	CONSTRAINT "chk_chiliz_sol_chz_swap_sha256" CHECK(length("chiliz_sol_chz_swap_journal"."signed_transaction_sha256") = 64 AND "chiliz_sol_chz_swap_journal"."signed_transaction_sha256" NOT GLOB '*[^0-9a-f]*' AND length("chiliz_sol_chz_swap_journal"."transaction_message_hash") = 64 AND "chiliz_sol_chz_swap_journal"."transaction_message_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_chiliz_sol_chz_swap_signature" CHECK(length("chiliz_sol_chz_swap_journal"."source_signature") BETWEEN 64 AND 88),
	CONSTRAINT "chk_chiliz_sol_chz_swap_sequence" CHECK("chiliz_sol_chz_swap_journal"."chunk_sequence" BETWEEN 0 AND 9999999 AND "chiliz_sol_chz_swap_journal"."attempt_sequence" BETWEEN 0 AND 2),
	CONSTRAINT "chk_chiliz_sol_chz_swap_offset" CHECK("chiliz_sol_chz_swap_journal"."chunk_offset_lamports" GLOB '[0-9]*' AND "chiliz_sol_chz_swap_journal"."chunk_offset_lamports" NOT GLOB '*[^0-9]*' AND ("chiliz_sol_chz_swap_journal"."chunk_offset_lamports" = '0' OR substr("chiliz_sol_chz_swap_journal"."chunk_offset_lamports",1,1) <> '0') AND length("chiliz_sol_chz_swap_journal"."chunk_offset_lamports") <= 16)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_swap_reservation_attempt` ON `chiliz_sol_chz_swap_journal` (`reservation_id`,`chunk_sequence`,`attempt_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_swap_successful_chunk` ON `chiliz_sol_chz_swap_journal` (`reservation_id`,`chunk_sequence`) WHERE state = 'finalized_success';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_swap_request` ON `chiliz_sol_chz_swap_journal` (`provider_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_swap_signature` ON `chiliz_sol_chz_swap_journal` (`source_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_swap_signed_sha256` ON `chiliz_sol_chz_swap_journal` (`signed_transaction_sha256`);--> statement-breakpoint
CREATE INDEX `idx_chiliz_sol_chz_swap_state` ON `chiliz_sol_chz_swap_journal` (`state`);
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_sol_chz_swap_insert_prepared` BEFORE INSERT
  ON `chiliz_sol_chz_swap_journal`
WHEN NEW.state <> 'prepared' OR NEW.broadcast_attempted_at_ms IS NOT NULL
  OR NEW.expiry_finalized_block_height IS NOT NULL
  OR NEW.finalized_slot IS NOT NULL OR NEW.receipt_evidence_json IS NOT NULL
  OR NEW.source_balance_before_lamports IS NOT NULL
  OR NEW.source_balance_after_lamports IS NOT NULL
  OR NEW.output_balance_before_atomic IS NOT NULL
  OR NEW.output_balance_after_atomic IS NOT NULL
  OR NEW.output_amount_atomic IS NOT NULL OR NEW.receipt_error_code IS NOT NULL
  OR length(NEW.provider_request_id) NOT BETWEEN 1 AND 200
  OR length(NEW.unsigned_transaction_base64) NOT BETWEEN 100 AND 4096
  OR length(NEW.signed_transaction_base64) NOT BETWEEN 100 AND 4096
  OR NEW.output_token_program NOT IN (
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
  OR NOT EXISTS (
    SELECT 1 FROM chiliz_fee_reservations r
    WHERE r.id = NEW.reservation_id
      AND NEW.id = 'chiliz:sol-chz:' || r.id || ':' || NEW.chunk_sequence || ':' || NEW.attempt_sequence
      AND NEW.source_wallet = r.reward_treasury
      AND NEW.chunk_sequence = (SELECT COUNT(*)
        FROM chiliz_sol_chz_swap_journal prior
        WHERE prior.reservation_id = r.id AND prior.state = 'finalized_success')
      AND NEW.attempt_sequence = COALESCE((SELECT MAX(prior.attempt_sequence) + 1
        FROM chiliz_sol_chz_swap_journal prior
        WHERE prior.reservation_id = r.id AND prior.chunk_sequence = NEW.chunk_sequence), 0)
      AND CAST(NEW.chunk_offset_lamports AS INTEGER) = COALESCE((
        SELECT SUM(CAST(prior.input_amount_lamports AS INTEGER))
        FROM chiliz_sol_chz_swap_journal prior
        WHERE prior.reservation_id = r.id AND prior.state = 'finalized_success'), 0)
      AND CAST(NEW.input_amount_lamports AS INTEGER) = MIN(100000000,
        CAST(r.reward_amount_lamports AS INTEGER)
          - CAST(NEW.chunk_offset_lamports AS INTEGER))
      AND NOT EXISTS (SELECT 1 FROM chiliz_sol_chz_swap_journal prior
        WHERE prior.reservation_id = r.id
          AND prior.state NOT IN ('finalized_success', 'finalized_failure', 'expired_unbroadcast'))
      AND NOT EXISTS (SELECT 1 FROM chiliz_sol_chz_swap_journal prior
        WHERE prior.reservation_id = r.id AND prior.chunk_sequence = NEW.chunk_sequence
          AND prior.state = 'finalized_success')
  )
BEGIN SELECT RAISE(ABORT, 'chiliz_sol_chz_swap_unbound_intent'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_sol_chz_swap_no_delete` BEFORE DELETE
  ON `chiliz_sol_chz_swap_journal`
BEGIN SELECT RAISE(ABORT, 'chiliz_sol_chz_swap_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_sol_chz_swap_one_way` BEFORE UPDATE
  ON `chiliz_sol_chz_swap_journal`
WHEN NEW.id IS NOT OLD.id OR NEW.reservation_id IS NOT OLD.reservation_id
  OR NEW.chunk_sequence IS NOT OLD.chunk_sequence
  OR NEW.attempt_sequence IS NOT OLD.attempt_sequence
  OR NEW.chunk_offset_lamports IS NOT OLD.chunk_offset_lamports
  OR NEW.source_wallet IS NOT OLD.source_wallet
  OR NEW.input_mint IS NOT OLD.input_mint OR NEW.output_mint IS NOT OLD.output_mint
  OR NEW.output_token_program IS NOT OLD.output_token_program
  OR NEW.output_ata IS NOT OLD.output_ata
  OR NEW.input_amount_lamports IS NOT OLD.input_amount_lamports
  OR NEW.minimum_output_atomic IS NOT OLD.minimum_output_atomic
  OR NEW.provider_request_id IS NOT OLD.provider_request_id
  OR NEW.last_valid_block_height IS NOT OLD.last_valid_block_height
  OR NEW.unsigned_transaction_base64 IS NOT OLD.unsigned_transaction_base64
  OR NEW.signed_transaction_base64 IS NOT OLD.signed_transaction_base64
  OR NEW.signed_transaction_sha256 IS NOT OLD.signed_transaction_sha256
  OR NEW.transaction_message_hash IS NOT OLD.transaction_message_hash
  OR NEW.source_signature IS NOT OLD.source_signature
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT (
    (OLD.state = 'prepared' AND NEW.state = 'broadcast_unknown'
      AND OLD.broadcast_attempted_at_ms IS NULL
      AND NEW.broadcast_attempted_at_ms > 0
      AND NEW.expiry_finalized_block_height IS NULL
      AND NEW.finalized_slot IS NULL AND NEW.receipt_evidence_json IS NULL
      AND NEW.source_balance_before_lamports IS NULL
      AND NEW.source_balance_after_lamports IS NULL
      AND NEW.output_balance_before_atomic IS NULL
      AND NEW.output_balance_after_atomic IS NULL
      AND NEW.output_amount_atomic IS NULL AND NEW.receipt_error_code IS NULL)
    OR (OLD.state = 'prepared' AND NEW.state = 'expired_unbroadcast'
      AND NEW.broadcast_attempted_at_ms IS NULL
      AND NEW.expiry_finalized_block_height > OLD.last_valid_block_height
      AND NEW.finalized_slot IS NULL AND NEW.receipt_evidence_json IS NULL
      AND NEW.source_balance_before_lamports IS NULL
      AND NEW.source_balance_after_lamports IS NULL
      AND NEW.output_balance_before_atomic IS NULL
      AND NEW.output_balance_after_atomic IS NULL
      AND NEW.output_amount_atomic IS NULL AND NEW.receipt_error_code IS NULL)
    OR (OLD.state = 'broadcast_unknown'
      AND NEW.state IN ('finalized_success', 'finalized_failure')
      AND NEW.broadcast_attempted_at_ms IS OLD.broadcast_attempted_at_ms
      AND NEW.expiry_finalized_block_height IS NULL
      AND NEW.finalized_slot > 0
      AND NEW.source_balance_before_lamports GLOB '[0-9]*'
      AND NEW.source_balance_before_lamports NOT GLOB '*[^0-9]*'
      AND length(NEW.source_balance_before_lamports) <= 18
      AND NEW.source_balance_after_lamports GLOB '[0-9]*'
      AND NEW.source_balance_after_lamports NOT GLOB '*[^0-9]*'
      AND length(NEW.source_balance_after_lamports) <= 18
      AND NEW.output_balance_before_atomic GLOB '[0-9]*'
      AND NEW.output_balance_before_atomic NOT GLOB '*[^0-9]*'
      AND length(NEW.output_balance_before_atomic) <= 18
      AND NEW.output_balance_after_atomic GLOB '[0-9]*'
      AND NEW.output_balance_after_atomic NOT GLOB '*[^0-9]*'
      AND length(NEW.output_balance_after_atomic) <= 18
      AND NEW.output_amount_atomic GLOB '[0-9]*'
      AND NEW.output_amount_atomic NOT GLOB '*[^0-9]*'
      AND length(NEW.output_amount_atomic) <= 18
      AND CAST(NEW.source_balance_before_lamports AS INTEGER)
        >= CAST(NEW.source_balance_after_lamports AS INTEGER)
      AND CAST(NEW.output_balance_after_atomic AS INTEGER)
        - CAST(NEW.output_balance_before_atomic AS INTEGER)
        = CAST(NEW.output_amount_atomic AS INTEGER)
      AND ((NEW.state = 'finalized_success'
          AND NEW.receipt_error_code IS NULL
          AND CAST(NEW.source_balance_before_lamports AS INTEGER)
            - CAST(NEW.source_balance_after_lamports AS INTEGER)
            BETWEEN CAST(NEW.input_amount_lamports AS INTEGER)
              AND CAST(NEW.input_amount_lamports AS INTEGER) + 500000
          AND CAST(NEW.output_amount_atomic AS INTEGER)
            >= CAST(NEW.minimum_output_atomic AS INTEGER))
        OR (NEW.state = 'finalized_failure'
          AND length(NEW.receipt_error_code) BETWEEN 1 AND 120
          AND NEW.output_amount_atomic = '0'
          AND CAST(NEW.source_balance_before_lamports AS INTEGER)
            - CAST(NEW.source_balance_after_lamports AS INTEGER) BETWEEN 0 AND 500000))
      AND json_valid(NEW.receipt_evidence_json)
      AND json_type(NEW.receipt_evidence_json) = 'object'
      AND NOT EXISTS (SELECT 1 FROM json_tree(NEW.receipt_evidence_json)
        WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
      AND json_extract(NEW.receipt_evidence_json, '$.finalized') = 1
      AND json_extract(NEW.receipt_evidence_json, '$.status') = NEW.state
      AND json_extract(NEW.receipt_evidence_json, '$.signature') = NEW.source_signature
      AND json_extract(NEW.receipt_evidence_json, '$.slot') = NEW.finalized_slot
      AND json_extract(NEW.receipt_evidence_json, '$.sourceWallet') = NEW.source_wallet
      AND json_extract(NEW.receipt_evidence_json, '$.outputAta') = NEW.output_ata
      AND json_extract(NEW.receipt_evidence_json, '$.sourceBalanceBeforeLamports')
        = NEW.source_balance_before_lamports
      AND json_extract(NEW.receipt_evidence_json, '$.sourceBalanceAfterLamports')
        = NEW.source_balance_after_lamports
      AND json_extract(NEW.receipt_evidence_json, '$.outputBalanceBeforeAtomic')
        = NEW.output_balance_before_atomic
      AND json_extract(NEW.receipt_evidence_json, '$.outputBalanceAfterAtomic')
        = NEW.output_balance_after_atomic
      AND json_extract(NEW.receipt_evidence_json, '$.outputAmountAtomic')
        = NEW.output_amount_atomic
      AND json_extract(NEW.receipt_evidence_json, '$.receiptErrorCode')
        IS NEW.receipt_error_code)
  )
BEGIN SELECT RAISE(ABORT, 'chiliz_sol_chz_swap_invalid_transition'); END;
