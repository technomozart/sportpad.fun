CREATE TABLE `chiliz_afc_v2_buy_canary` (
	`id` text PRIMARY KEY NOT NULL,
	`treasury_address` text NOT NULL,
	`fan_token_contract` text NOT NULL,
	`amount_in_wei` text NOT NULL,
	`minimum_output_atomic` text NOT NULL,
	`nonce` integer NOT NULL,
	`deadline_epoch_seconds` integer NOT NULL,
	`maximum_network_fee_wei` text NOT NULL,
	`tx_hash` text NOT NULL,
	`raw_transaction` text NOT NULL,
	`intent_json` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`broadcast_attempted_at_ms` integer,
	`receipt_status` text,
	`receipt_block_hash` text,
	`receipt_block_number` integer,
	`finalized_block_number` integer,
	`output_amount_atomic` text,
	`receipt_evidence_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_afc_v2_buy_canary_id" CHECK("chiliz_afc_v2_buy_canary"."id" = 'initial'),
	CONSTRAINT "chk_afc_v2_buy_canary_token" CHECK("chiliz_afc_v2_buy_canary"."fan_token_contract" = '0x76088f3ed5dc655de9295d93868ec1eec654a615'),
	CONSTRAINT "chk_afc_v2_buy_canary_amount" CHECK("chiliz_afc_v2_buy_canary"."amount_in_wei" = '10000000000000000'),
	CONSTRAINT "chk_afc_v2_buy_canary_minimum" CHECK("chiliz_afc_v2_buy_canary"."minimum_output_atomic" GLOB '[1-9]*' AND "chiliz_afc_v2_buy_canary"."minimum_output_atomic" NOT GLOB '*[^0-9]*' AND (length("chiliz_afc_v2_buy_canary"."minimum_output_atomic") > 13 OR (length("chiliz_afc_v2_buy_canary"."minimum_output_atomic") = 13 AND "chiliz_afc_v2_buy_canary"."minimum_output_atomic" >= '1000000000000'))),
	CONSTRAINT "chk_afc_v2_buy_canary_nonce" CHECK("chiliz_afc_v2_buy_canary"."nonce" >= 0),
	CONSTRAINT "chk_afc_v2_buy_canary_deadline" CHECK("chiliz_afc_v2_buy_canary"."deadline_epoch_seconds" > 0),
	CONSTRAINT "chk_afc_v2_buy_canary_gas" CHECK("chiliz_afc_v2_buy_canary"."maximum_network_fee_wei" GLOB '[1-9]*' AND "chiliz_afc_v2_buy_canary"."maximum_network_fee_wei" NOT GLOB '*[^0-9]*' AND (length("chiliz_afc_v2_buy_canary"."maximum_network_fee_wei") < 19 OR (length("chiliz_afc_v2_buy_canary"."maximum_network_fee_wei") = 19 AND "chiliz_afc_v2_buy_canary"."maximum_network_fee_wei" <= '1000000000000000000'))),
	CONSTRAINT "chk_afc_v2_buy_canary_hash" CHECK(length("chiliz_afc_v2_buy_canary"."tx_hash") = 66 AND substr("chiliz_afc_v2_buy_canary"."tx_hash",1,2) = '0x' AND substr("chiliz_afc_v2_buy_canary"."tx_hash",3) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_afc_v2_buy_canary_state" CHECK("chiliz_afc_v2_buy_canary"."state" IN ('prepared','broadcast_attempted','finalized_success','finalized_reverted')),
	CONSTRAINT "chk_afc_v2_buy_canary_state_shape" CHECK(("chiliz_afc_v2_buy_canary"."state" = 'prepared' AND "chiliz_afc_v2_buy_canary"."broadcast_attempted_at_ms" IS NULL AND "chiliz_afc_v2_buy_canary"."receipt_status" IS NULL AND "chiliz_afc_v2_buy_canary"."receipt_block_hash" IS NULL AND "chiliz_afc_v2_buy_canary"."receipt_block_number" IS NULL AND "chiliz_afc_v2_buy_canary"."finalized_block_number" IS NULL AND "chiliz_afc_v2_buy_canary"."output_amount_atomic" IS NULL AND "chiliz_afc_v2_buy_canary"."receipt_evidence_json" IS NULL) OR ("chiliz_afc_v2_buy_canary"."state" = 'broadcast_attempted' AND "chiliz_afc_v2_buy_canary"."broadcast_attempted_at_ms" > 0 AND "chiliz_afc_v2_buy_canary"."receipt_status" IS NULL AND "chiliz_afc_v2_buy_canary"."receipt_block_hash" IS NULL AND "chiliz_afc_v2_buy_canary"."receipt_block_number" IS NULL AND "chiliz_afc_v2_buy_canary"."finalized_block_number" IS NULL AND "chiliz_afc_v2_buy_canary"."output_amount_atomic" IS NULL AND "chiliz_afc_v2_buy_canary"."receipt_evidence_json" IS NULL) OR ("chiliz_afc_v2_buy_canary"."state" IN ('finalized_success','finalized_reverted') AND "chiliz_afc_v2_buy_canary"."broadcast_attempted_at_ms" > 0 AND "chiliz_afc_v2_buy_canary"."receipt_status" IN ('success','reverted') AND "chiliz_afc_v2_buy_canary"."receipt_block_hash" IS NOT NULL AND "chiliz_afc_v2_buy_canary"."receipt_block_number" > 0 AND "chiliz_afc_v2_buy_canary"."finalized_block_number" >= "chiliz_afc_v2_buy_canary"."receipt_block_number" AND "chiliz_afc_v2_buy_canary"."receipt_evidence_json" IS NOT NULL AND (("chiliz_afc_v2_buy_canary"."state" = 'finalized_success' AND "chiliz_afc_v2_buy_canary"."receipt_status" = 'success' AND "chiliz_afc_v2_buy_canary"."output_amount_atomic" IS NOT NULL) OR ("chiliz_afc_v2_buy_canary"."state" = 'finalized_reverted' AND "chiliz_afc_v2_buy_canary"."receipt_status" = 'reverted' AND "chiliz_afc_v2_buy_canary"."output_amount_atomic" = '0'))))
);
--> statement-breakpoint
-- One fixed primary key is the durable no-replacement fence. No row is seeded.
CREATE TRIGGER `trg_afc_v2_buy_canary_insert_prepared` BEFORE INSERT
  ON `chiliz_afc_v2_buy_canary`
WHEN NEW.state <> 'prepared' OR NEW.broadcast_attempted_at_ms IS NOT NULL
  OR NEW.receipt_status IS NOT NULL OR NEW.receipt_block_hash IS NOT NULL
  OR NEW.receipt_block_number IS NOT NULL OR NEW.finalized_block_number IS NOT NULL
  OR NEW.output_amount_atomic IS NOT NULL OR NEW.receipt_evidence_json IS NOT NULL
  OR NOT json_valid(NEW.intent_json)
  OR length(NEW.raw_transaction) NOT BETWEEN 200 AND 10000
  OR substr(NEW.raw_transaction,1,2) <> '0x'
  OR substr(NEW.raw_transaction,3) GLOB '*[^0-9a-f]*'
BEGIN SELECT RAISE(ABORT, 'afc_v2_buy_canary_insert_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_afc_v2_buy_canary_identity_immutable` BEFORE UPDATE OF
  id, treasury_address, fan_token_contract, amount_in_wei,
  minimum_output_atomic, nonce, deadline_epoch_seconds,
  maximum_network_fee_wei, tx_hash, raw_transaction, intent_json, created_at
  ON `chiliz_afc_v2_buy_canary`
BEGIN SELECT RAISE(ABORT, 'afc_v2_buy_canary_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_afc_v2_buy_canary_one_way` BEFORE UPDATE
  ON `chiliz_afc_v2_buy_canary`
WHEN NOT (
  OLD.state = 'prepared' AND NEW.state = 'broadcast_attempted'
    AND OLD.broadcast_attempted_at_ms IS NULL
    AND NEW.broadcast_attempted_at_ms > 0
    AND NEW.receipt_status IS NULL AND NEW.receipt_block_hash IS NULL
    AND NEW.receipt_block_number IS NULL AND NEW.finalized_block_number IS NULL
    AND NEW.output_amount_atomic IS NULL AND NEW.receipt_evidence_json IS NULL
  OR OLD.state = 'broadcast_attempted'
    AND NEW.state IN ('finalized_success','finalized_reverted')
    AND NEW.broadcast_attempted_at_ms IS OLD.broadcast_attempted_at_ms
    AND NEW.receipt_block_number > 0
    AND NEW.finalized_block_number >= NEW.receipt_block_number
    AND json_valid(NEW.receipt_evidence_json)
) OR NEW.updated_at < OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'afc_v2_buy_canary_one_way'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_afc_v2_buy_canary_no_delete` BEFORE DELETE
  ON `chiliz_afc_v2_buy_canary`
BEGIN SELECT RAISE(ABORT, 'afc_v2_buy_canary_no_delete'); END;
