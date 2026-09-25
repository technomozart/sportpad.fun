CREATE TABLE `chiliz_sol_chz_canary_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`source_wallet` text NOT NULL,
	`output_ata` text NOT NULL,
	`input_lamports` integer NOT NULL,
	`maximum_spend_lamports` integer NOT NULL,
	`minimum_output_atomic` text NOT NULL,
	`provider_request_id` text,
	`last_valid_block_height` integer NOT NULL,
	`unsigned_transaction_base64` text NOT NULL,
	`signed_transaction_base64` text NOT NULL,
	`signed_plan_json` text NOT NULL,
	`signed_transaction_sha256` text NOT NULL,
	`transaction_message_hash` text NOT NULL,
	`source_signature` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`broadcast_attempted_at_ms` integer,
	`finalized_slot` integer,
	`actual_spend_lamports` integer,
	`actual_output_atomic` text,
	`receipt_evidence_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_chiliz_sol_chz_canary_operation" CHECK("chiliz_sol_chz_canary_journal"."operation" IN ('ata_setup', 'sol_chz_swap')),
	CONSTRAINT "chk_chiliz_sol_chz_canary_state" CHECK("chiliz_sol_chz_canary_journal"."state" IN ('prepared', 'broadcast_unknown', 'finalized_success', 'finalized_failure')),
	CONSTRAINT "chk_chiliz_sol_chz_canary_max_spend" CHECK("chiliz_sol_chz_canary_journal"."maximum_spend_lamports" > 0 AND "chiliz_sol_chz_canary_journal"."maximum_spend_lamports" <= 5000000),
	CONSTRAINT "chk_chiliz_sol_chz_canary_input" CHECK(("chiliz_sol_chz_canary_journal"."operation" = 'ata_setup' AND "chiliz_sol_chz_canary_journal"."input_lamports" = 0 AND "chiliz_sol_chz_canary_journal"."minimum_output_atomic" = '0' AND "chiliz_sol_chz_canary_journal"."provider_request_id" IS NULL) OR ("chiliz_sol_chz_canary_journal"."operation" = 'sol_chz_swap' AND "chiliz_sol_chz_canary_journal"."input_lamports" = 1000000 AND "chiliz_sol_chz_canary_journal"."maximum_spend_lamports" BETWEEN 1000000 AND 1500000 AND "chiliz_sol_chz_canary_journal"."minimum_output_atomic" GLOB '[1-9]*' AND "chiliz_sol_chz_canary_journal"."minimum_output_atomic" NOT GLOB '*[^0-9]*' AND length("chiliz_sol_chz_canary_journal"."minimum_output_atomic") <= 18 AND "chiliz_sol_chz_canary_journal"."provider_request_id" IS NOT NULL)),
	CONSTRAINT "chk_chiliz_sol_chz_canary_height" CHECK("chiliz_sol_chz_canary_journal"."last_valid_block_height" > 0),
	CONSTRAINT "chk_chiliz_sol_chz_canary_hashes" CHECK(length("chiliz_sol_chz_canary_journal"."signed_transaction_sha256") = 64 AND "chiliz_sol_chz_canary_journal"."signed_transaction_sha256" NOT GLOB '*[^0-9a-f]*' AND length("chiliz_sol_chz_canary_journal"."transaction_message_hash") = 64 AND "chiliz_sol_chz_canary_journal"."transaction_message_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_chiliz_sol_chz_canary_signature" CHECK(length("chiliz_sol_chz_canary_journal"."source_signature") BETWEEN 64 AND 88)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_canary_operation` ON `chiliz_sol_chz_canary_journal` (`operation`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_canary_signature` ON `chiliz_sol_chz_canary_journal` (`source_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_sol_chz_canary_signed_sha256` ON `chiliz_sol_chz_canary_journal` (`signed_transaction_sha256`);--> statement-breakpoint
CREATE INDEX `idx_chiliz_sol_chz_canary_state` ON `chiliz_sol_chz_canary_journal` (`state`);
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_sol_chz_canary_insert_guard`
BEFORE INSERT ON `chiliz_sol_chz_canary_journal`
WHEN NOT (
  NEW.state = 'prepared'
  AND NEW.broadcast_attempted_at_ms IS NULL
  AND NEW.finalized_slot IS NULL
  AND NEW.actual_spend_lamports IS NULL
  AND NEW.actual_output_atomic IS NULL
  AND NEW.receipt_evidence_json IS NULL
  AND NEW.id = 'sportpad-chz-canary:' || NEW.operation
  AND length(NEW.unsigned_transaction_base64) BETWEEN 100 AND 4096
  AND length(NEW.signed_transaction_base64) BETWEEN 100 AND 4096
  AND length(NEW.signed_plan_json) BETWEEN 100 AND 20000
  AND json_valid(NEW.signed_plan_json)
  AND json_extract(NEW.signed_plan_json, '$.sourceSignature') = NEW.source_signature
  AND json_extract(NEW.signed_plan_json, '$.signedTransactionSha256') = NEW.signed_transaction_sha256
  AND NEW.output_ata <> NEW.source_wallet
  AND (SELECT COALESCE(SUM(maximum_spend_lamports), 0)
       FROM chiliz_sol_chz_canary_journal) + NEW.maximum_spend_lamports <= 5000000
)
BEGIN SELECT RAISE(ABORT, 'chiliz_canary_insert_rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_sol_chz_canary_update_guard`
BEFORE UPDATE ON `chiliz_sol_chz_canary_journal`
WHEN NOT (
  OLD.id IS NEW.id AND OLD.operation IS NEW.operation
  AND OLD.source_wallet IS NEW.source_wallet AND OLD.output_ata IS NEW.output_ata
  AND OLD.input_lamports IS NEW.input_lamports
  AND OLD.maximum_spend_lamports IS NEW.maximum_spend_lamports
  AND OLD.minimum_output_atomic IS NEW.minimum_output_atomic
  AND OLD.provider_request_id IS NEW.provider_request_id
  AND OLD.last_valid_block_height IS NEW.last_valid_block_height
  AND OLD.unsigned_transaction_base64 IS NEW.unsigned_transaction_base64
  AND OLD.signed_transaction_base64 IS NEW.signed_transaction_base64
  AND OLD.signed_plan_json IS NEW.signed_plan_json
  AND OLD.signed_transaction_sha256 IS NEW.signed_transaction_sha256
  AND OLD.transaction_message_hash IS NEW.transaction_message_hash
  AND OLD.source_signature IS NEW.source_signature
  AND OLD.created_at IS NEW.created_at
  AND (
    (OLD.state = 'prepared' AND NEW.state = 'broadcast_unknown'
      AND OLD.broadcast_attempted_at_ms IS NULL
      AND NEW.broadcast_attempted_at_ms > 0
      AND NEW.finalized_slot IS NULL AND NEW.actual_spend_lamports IS NULL
      AND NEW.actual_output_atomic IS NULL AND NEW.receipt_evidence_json IS NULL)
    OR
    (OLD.state = 'broadcast_unknown'
      AND NEW.state IN ('finalized_success', 'finalized_failure')
      AND NEW.broadcast_attempted_at_ms IS OLD.broadcast_attempted_at_ms
      AND NEW.finalized_slot > 0
      AND NEW.actual_spend_lamports BETWEEN 0 AND NEW.maximum_spend_lamports
      AND NEW.actual_output_atomic GLOB '[0-9]*'
      AND NEW.actual_output_atomic NOT GLOB '*[^0-9]*'
      AND length(NEW.actual_output_atomic) <= 18
      AND json_valid(NEW.receipt_evidence_json)
      AND json_type(NEW.receipt_evidence_json) = 'object'
      AND NOT EXISTS (SELECT 1 FROM json_tree(NEW.receipt_evidence_json)
        WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
      AND json_extract(NEW.receipt_evidence_json, '$.signature') = NEW.source_signature
      AND json_extract(NEW.receipt_evidence_json, '$.slot') = NEW.finalized_slot
      AND json_extract(NEW.receipt_evidence_json, '$.operation') = NEW.operation
      AND json_extract(NEW.receipt_evidence_json, '$.actualSpendLamports') = NEW.actual_spend_lamports
      AND json_extract(NEW.receipt_evidence_json, '$.actualOutputAtomic') = NEW.actual_output_atomic
      AND ((NEW.state = 'finalized_success'
        AND (NEW.operation = 'ata_setup' AND NEW.actual_output_atomic = '0'
          OR NEW.operation = 'sol_chz_swap'
            AND CAST(NEW.actual_output_atomic AS INTEGER) >= CAST(NEW.minimum_output_atomic AS INTEGER)))
        OR (NEW.state = 'finalized_failure' AND NEW.actual_output_atomic = '0')))
  )
)
BEGIN SELECT RAISE(ABORT, 'chiliz_canary_transition_rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_sol_chz_canary_no_delete`
BEFORE DELETE ON `chiliz_sol_chz_canary_journal`
BEGIN SELECT RAISE(ABORT, 'chiliz_canary_delete_rejected'); END;
