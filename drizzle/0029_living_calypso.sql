CREATE TABLE `chiliz_bridge_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`bridge_id` text NOT NULL,
	`swap_intent_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`fee_event_id` text NOT NULL,
	`launch_id` text NOT NULL,
	`swap_output_offset_atomic` text NOT NULL,
	`amount_atomic` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`bridge_id`) REFERENCES `chiliz_bridge_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`swap_intent_id`) REFERENCES `chiliz_sol_chz_swap_journal`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `chiliz_fee_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fee_event_id`) REFERENCES `fee_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_bridge_allocations_offset" CHECK("chiliz_bridge_allocations"."swap_output_offset_atomic" GLOB '[0-9]*' AND "chiliz_bridge_allocations"."swap_output_offset_atomic" NOT GLOB '*[^0-9]*' AND ("chiliz_bridge_allocations"."swap_output_offset_atomic" = '0' OR substr("chiliz_bridge_allocations"."swap_output_offset_atomic",1,1) <> '0') AND length("chiliz_bridge_allocations"."swap_output_offset_atomic") <= 18),
	CONSTRAINT "chk_chiliz_bridge_allocations_amount" CHECK("chiliz_bridge_allocations"."amount_atomic" GLOB '[1-9]*' AND "chiliz_bridge_allocations"."amount_atomic" NOT GLOB '*[^0-9]*' AND length("chiliz_bridge_allocations"."amount_atomic") <= 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_allocations_swap_offset` ON `chiliz_bridge_allocations` (`swap_intent_id`,`swap_output_offset_atomic`);--> statement-breakpoint
CREATE INDEX `idx_chiliz_bridge_allocations_bridge` ON `chiliz_bridge_allocations` (`bridge_id`);--> statement-breakpoint
CREATE INDEX `idx_chiliz_bridge_allocations_fee_event` ON `chiliz_bridge_allocations` (`fee_event_id`);--> statement-breakpoint
CREATE TABLE `chiliz_bridge_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`source_wallet` text NOT NULL,
	`destination_treasury` text NOT NULL,
	`source_mint` text NOT NULL,
	`destination_chain_id` integer NOT NULL,
	`source_amount_atomic` text NOT NULL,
	`minimum_destination_wei` text NOT NULL,
	`quote_id` text,
	`quote_expires_at_ms` integer,
	`signed_transaction_base64` text,
	`signed_transaction_sha256` text,
	`source_signature` text,
	`state` text DEFAULT 'collecting' NOT NULL,
	`broadcast_attempted_at_ms` integer,
	`source_finalized_slot` integer,
	`source_evidence_json` text,
	`bridge_message_id` text,
	`destination_tx_hash` text,
	`destination_finalized_block` integer,
	`destination_received_wei` text,
	`destination_evidence_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_chiliz_bridge_transfers_mint" CHECK("chiliz_bridge_transfers"."source_mint" = '6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw'),
	CONSTRAINT "chk_chiliz_bridge_transfers_destination" CHECK("chiliz_bridge_transfers"."destination_chain_id" = 88888 AND length("chiliz_bridge_transfers"."destination_treasury") = 42 AND substr("chiliz_bridge_transfers"."destination_treasury",1,2) = '0x' AND substr("chiliz_bridge_transfers"."destination_treasury",3) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_chiliz_bridge_transfers_source_cap" CHECK("chiliz_bridge_transfers"."source_amount_atomic" GLOB '[1-9]*' AND "chiliz_bridge_transfers"."source_amount_atomic" NOT GLOB '*[^0-9]*' AND (length("chiliz_bridge_transfers"."source_amount_atomic") < 10 OR (length("chiliz_bridge_transfers"."source_amount_atomic") = 10 AND "chiliz_bridge_transfers"."source_amount_atomic" <= '1000000000'))),
	CONSTRAINT "chk_chiliz_bridge_transfers_minimum" CHECK("chiliz_bridge_transfers"."minimum_destination_wei" GLOB '[1-9]*' AND "chiliz_bridge_transfers"."minimum_destination_wei" NOT GLOB '*[^0-9]*' AND length("chiliz_bridge_transfers"."minimum_destination_wei") <= 20),
	CONSTRAINT "chk_chiliz_bridge_transfers_parity" CHECK(
		length("chiliz_bridge_transfers"."minimum_destination_wei") > 10
		AND substr("chiliz_bridge_transfers"."minimum_destination_wei", -10) = '0000000000'
		AND (
			length("chiliz_bridge_transfers"."minimum_destination_wei") > length(CAST((CAST("chiliz_bridge_transfers"."source_amount_atomic" AS INTEGER) * 95 + 99) / 100 AS TEXT) || '0000000000')
			OR (length("chiliz_bridge_transfers"."minimum_destination_wei") = length(CAST((CAST("chiliz_bridge_transfers"."source_amount_atomic" AS INTEGER) * 95 + 99) / 100 AS TEXT) || '0000000000')
				AND "chiliz_bridge_transfers"."minimum_destination_wei" >= CAST((CAST("chiliz_bridge_transfers"."source_amount_atomic" AS INTEGER) * 95 + 99) / 100 AS TEXT) || '0000000000')
		)
		AND (
			length("chiliz_bridge_transfers"."minimum_destination_wei") < length("chiliz_bridge_transfers"."source_amount_atomic" || '0000000000')
			OR (length("chiliz_bridge_transfers"."minimum_destination_wei") = length("chiliz_bridge_transfers"."source_amount_atomic" || '0000000000')
				AND "chiliz_bridge_transfers"."minimum_destination_wei" <= "chiliz_bridge_transfers"."source_amount_atomic" || '0000000000')
		)
	),
	CONSTRAINT "chk_chiliz_bridge_transfers_state" CHECK("chiliz_bridge_transfers"."state" IN ('collecting','prepared','broadcast_unknown','source_finalized','destination_finalized','held'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_transfers_quote` ON `chiliz_bridge_transfers` (`quote_id`) WHERE "chiliz_bridge_transfers"."quote_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_transfers_signature` ON `chiliz_bridge_transfers` (`source_signature`) WHERE "chiliz_bridge_transfers"."source_signature" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_transfers_signed_sha256` ON `chiliz_bridge_transfers` (`signed_transaction_sha256`) WHERE "chiliz_bridge_transfers"."signed_transaction_sha256" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_transfers_message` ON `chiliz_bridge_transfers` (`bridge_message_id`) WHERE "chiliz_bridge_transfers"."bridge_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_transfers_destination_tx` ON `chiliz_bridge_transfers` (`destination_tx_hash`) WHERE "chiliz_bridge_transfers"."destination_tx_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_chiliz_bridge_transfers_state` ON `chiliz_bridge_transfers` (`state`);
-- The one-shot legacy canary and repeatable lane share a physical CHZ treasury.
-- Cross-ledger ID uniqueness does not serialize independent sends; operators
-- must keep the legacy canary disabled while any repeatable lane is active.
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_transfer_insert_collecting` BEFORE INSERT
  ON `chiliz_bridge_transfers`
WHEN NEW.state <> 'collecting' OR length(NEW.source_wallet) NOT BETWEEN 32 AND 44
  OR NEW.quote_id IS NOT NULL OR NEW.quote_expires_at_ms IS NOT NULL
  OR NEW.signed_transaction_base64 IS NOT NULL
  OR NEW.signed_transaction_sha256 IS NOT NULL OR NEW.source_signature IS NOT NULL
  OR NEW.broadcast_attempted_at_ms IS NOT NULL
  OR NEW.source_finalized_slot IS NOT NULL OR NEW.source_evidence_json IS NOT NULL
  OR NEW.bridge_message_id IS NOT NULL OR NEW.destination_tx_hash IS NOT NULL
  OR NEW.destination_finalized_block IS NOT NULL OR NEW.destination_received_wei IS NOT NULL
  OR NEW.destination_evidence_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_transfer_insert_unsealed'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_transfer_identity_immutable` BEFORE UPDATE OF
  id, source_wallet, destination_treasury, source_mint, destination_chain_id,
  source_amount_atomic, minimum_destination_wei, created_at
  ON `chiliz_bridge_transfers`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_transfer_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_transfer_no_delete` BEFORE DELETE
  ON `chiliz_bridge_transfers`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_transfer_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_allocation_insert_verified` BEFORE INSERT
  ON `chiliz_bridge_allocations`
WHEN NOT EXISTS (
  SELECT 1 FROM chiliz_bridge_transfers b
  JOIN chiliz_sol_chz_swap_journal swap ON swap.id = NEW.swap_intent_id
  JOIN chiliz_fee_reservations r ON r.id = swap.reservation_id
  JOIN fee_events f ON f.id = r.fee_event_id
  JOIN launch_drafts l ON l.id = r.launch_id
  WHERE b.id = NEW.bridge_id AND b.state = 'collecting'
    AND swap.state = 'finalized_success' AND swap.output_amount_atomic IS NOT NULL
    AND swap.output_mint = '6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw'
    AND swap.source_wallet = b.source_wallet AND r.reward_treasury = b.source_wallet
    AND NEW.reservation_id = r.id AND NEW.fee_event_id = f.id
    AND NEW.launch_id = l.id AND f.launch_id = l.id
    AND CAST(NEW.swap_output_offset_atomic AS INTEGER) = COALESCE((
      SELECT SUM(CAST(prior.amount_atomic AS INTEGER))
      FROM chiliz_bridge_allocations prior WHERE prior.swap_intent_id = swap.id), 0)
    AND CAST(NEW.swap_output_offset_atomic AS INTEGER) + CAST(NEW.amount_atomic AS INTEGER)
      <= CAST(swap.output_amount_atomic AS INTEGER)
    AND CAST(NEW.amount_atomic AS INTEGER) + COALESCE((
      SELECT SUM(CAST(prior.amount_atomic AS INTEGER))
      FROM chiliz_bridge_allocations prior WHERE prior.bridge_id = b.id), 0)
      <= CAST(b.source_amount_atomic AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_allocation_unbacked'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_allocation_no_update` BEFORE UPDATE
  ON `chiliz_bridge_allocations`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_allocation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_allocation_no_delete` BEFORE DELETE
  ON `chiliz_bridge_allocations`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_allocation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_transfer_one_way` BEFORE UPDATE
  ON `chiliz_bridge_transfers`
WHEN NOT (
  (OLD.state = 'collecting' AND NEW.state = 'prepared'
    AND length(NEW.quote_id) BETWEEN 4 AND 256
    AND NEW.quote_expires_at_ms > 0
    AND length(NEW.signed_transaction_base64) BETWEEN 100 AND 4096
    AND length(NEW.signed_transaction_sha256) = 64
    AND NEW.signed_transaction_sha256 NOT GLOB '*[^0-9a-f]*'
    AND length(NEW.source_signature) BETWEEN 64 AND 88
    AND NEW.broadcast_attempted_at_ms IS NULL
    AND NEW.source_finalized_slot IS NULL AND NEW.source_evidence_json IS NULL
    AND NEW.bridge_message_id IS NULL AND NEW.destination_tx_hash IS NULL
    AND NEW.destination_finalized_block IS NULL AND NEW.destination_received_wei IS NULL
    AND NEW.destination_evidence_json IS NULL
    AND CAST(NEW.source_amount_atomic AS INTEGER) = COALESCE((
      SELECT SUM(CAST(a.amount_atomic AS INTEGER))
      FROM chiliz_bridge_allocations a WHERE a.bridge_id = OLD.id), 0))
  OR (OLD.state = 'prepared' AND NEW.state = 'broadcast_unknown'
    AND NEW.quote_id IS OLD.quote_id
    AND NEW.quote_expires_at_ms IS OLD.quote_expires_at_ms
    AND NEW.signed_transaction_base64 IS OLD.signed_transaction_base64
    AND NEW.signed_transaction_sha256 IS OLD.signed_transaction_sha256
    AND NEW.source_signature IS OLD.source_signature
    AND NEW.broadcast_attempted_at_ms > 0
    AND NEW.broadcast_attempted_at_ms < NEW.quote_expires_at_ms
    AND NEW.source_finalized_slot IS NULL AND NEW.source_evidence_json IS NULL
    AND NEW.bridge_message_id IS NULL AND NEW.destination_tx_hash IS NULL
    AND NEW.destination_finalized_block IS NULL AND NEW.destination_received_wei IS NULL
    AND NEW.destination_evidence_json IS NULL)
  OR (OLD.state IN ('broadcast_unknown', 'held') AND NEW.state = 'source_finalized'
    AND OLD.source_finalized_slot IS NULL
    AND NEW.quote_id IS OLD.quote_id
    AND NEW.quote_expires_at_ms IS OLD.quote_expires_at_ms
    AND NEW.signed_transaction_base64 IS OLD.signed_transaction_base64
    AND NEW.signed_transaction_sha256 IS OLD.signed_transaction_sha256
    AND NEW.source_signature IS OLD.source_signature
    AND NEW.broadcast_attempted_at_ms IS OLD.broadcast_attempted_at_ms
    AND NEW.source_finalized_slot > 0
    AND length(NEW.bridge_message_id) = 66
    AND substr(NEW.bridge_message_id,1,2) = '0x'
    AND substr(NEW.bridge_message_id,3) NOT GLOB '*[^0-9a-f]*'
    AND json_valid(NEW.source_evidence_json)
    AND json_type(NEW.source_evidence_json) = 'object'
    AND NOT EXISTS (SELECT 1 FROM json_tree(NEW.source_evidence_json)
      WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
    AND json_extract(NEW.source_evidence_json,'$.finalized') = 1
    AND json_extract(NEW.source_evidence_json,'$.sourceSignature') = NEW.source_signature
    AND json_extract(NEW.source_evidence_json,'$.sourceWallet') = NEW.source_wallet
    AND json_extract(NEW.source_evidence_json,'$.sourceAmountAtomic') = NEW.source_amount_atomic
    AND json_extract(NEW.source_evidence_json,'$.finalizedSlot') = NEW.source_finalized_slot
    AND json_extract(NEW.source_evidence_json,'$.bridgeMessageId') = NEW.bridge_message_id
    AND NEW.destination_tx_hash IS NULL AND NEW.destination_finalized_block IS NULL
    AND NEW.destination_received_wei IS NULL AND NEW.destination_evidence_json IS NULL)
  OR (OLD.state IN ('source_finalized', 'held') AND NEW.state = 'destination_finalized'
    AND OLD.source_finalized_slot IS NOT NULL
    AND NEW.quote_id IS OLD.quote_id
    AND NEW.quote_expires_at_ms IS OLD.quote_expires_at_ms
    AND NEW.signed_transaction_base64 IS OLD.signed_transaction_base64
    AND NEW.signed_transaction_sha256 IS OLD.signed_transaction_sha256
    AND NEW.source_signature IS OLD.source_signature
    AND NEW.broadcast_attempted_at_ms IS OLD.broadcast_attempted_at_ms
    AND NEW.source_finalized_slot IS OLD.source_finalized_slot
    AND NEW.source_evidence_json IS OLD.source_evidence_json
    AND NEW.bridge_message_id IS OLD.bridge_message_id
    AND length(NEW.destination_tx_hash) = 66
    AND substr(NEW.destination_tx_hash,1,2) = '0x'
    AND substr(NEW.destination_tx_hash,3) NOT GLOB '*[^0-9a-f]*'
    AND NEW.destination_finalized_block > 0
    AND NEW.destination_received_wei GLOB '[1-9]*'
    AND NEW.destination_received_wei NOT GLOB '*[^0-9]*'
    AND length(NEW.destination_received_wei) <= 20
    AND (length(NEW.destination_received_wei) > length(NEW.minimum_destination_wei)
      OR (length(NEW.destination_received_wei) = length(NEW.minimum_destination_wei)
        AND NEW.destination_received_wei >= NEW.minimum_destination_wei))
    AND json_valid(NEW.destination_evidence_json)
    AND json_type(NEW.destination_evidence_json) = 'object'
    AND NOT EXISTS (SELECT 1 FROM json_tree(NEW.destination_evidence_json)
      WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
    AND json_extract(NEW.destination_evidence_json,'$.finalized') = 1
    AND json_extract(NEW.destination_evidence_json,'$.chainId') = 88888
    AND json_extract(NEW.destination_evidence_json,'$.bridgeMessageId') = NEW.bridge_message_id
    AND json_extract(NEW.destination_evidence_json,'$.destinationTreasury') = NEW.destination_treasury
    AND json_extract(NEW.destination_evidence_json,'$.transactionHash') = NEW.destination_tx_hash
    AND json_extract(NEW.destination_evidence_json,'$.finalizedBlock') = NEW.destination_finalized_block
    AND json_extract(NEW.destination_evidence_json,'$.receivedWei') = NEW.destination_received_wei)
  OR (OLD.state IN ('broadcast_unknown','source_finalized') AND NEW.state = 'held'
    AND NEW.quote_id IS OLD.quote_id
    AND NEW.quote_expires_at_ms IS OLD.quote_expires_at_ms
    AND NEW.signed_transaction_base64 IS OLD.signed_transaction_base64
    AND NEW.signed_transaction_sha256 IS OLD.signed_transaction_sha256
    AND NEW.source_signature IS OLD.source_signature
    AND NEW.broadcast_attempted_at_ms IS OLD.broadcast_attempted_at_ms
    AND NEW.source_finalized_slot IS OLD.source_finalized_slot
    AND NEW.source_evidence_json IS OLD.source_evidence_json
    AND NEW.bridge_message_id IS OLD.bridge_message_id
    AND NEW.destination_tx_hash IS NULL AND NEW.destination_finalized_block IS NULL
    AND NEW.destination_received_wei IS NULL AND NEW.destination_evidence_json IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_transfer_invalid_transition'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_transfer_no_legacy_reuse` BEFORE UPDATE
  ON `chiliz_bridge_transfers`
WHEN EXISTS (SELECT 1 FROM chiliz_bridge_journal legacy WHERE
  (NEW.quote_id IS NOT NULL AND legacy.quote_id = NEW.quote_id) OR
  (NEW.signed_transaction_sha256 IS NOT NULL AND
    legacy.signed_transaction_sha256 = NEW.signed_transaction_sha256) OR
  (NEW.source_signature IS NOT NULL AND legacy.source_signature = NEW.source_signature) OR
  (NEW.bridge_message_id IS NOT NULL AND legacy.bridge_message_id = NEW.bridge_message_id) OR
  (NEW.destination_tx_hash IS NOT NULL AND legacy.destination_tx_hash = NEW.destination_tx_hash))
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_transfer_legacy_reuse'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_legacy_bridge_no_repeat_reuse` BEFORE INSERT
  ON `chiliz_bridge_journal`
WHEN EXISTS (SELECT 1 FROM chiliz_bridge_transfers repeat WHERE
  repeat.quote_id = NEW.quote_id OR
  repeat.signed_transaction_sha256 = NEW.signed_transaction_sha256 OR
  repeat.source_signature = NEW.source_signature OR
  (NEW.bridge_message_id IS NOT NULL AND repeat.bridge_message_id = NEW.bridge_message_id) OR
  (NEW.destination_tx_hash IS NOT NULL AND repeat.destination_tx_hash = NEW.destination_tx_hash))
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_legacy_repeat_reuse'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_legacy_bridge_no_repeat_evidence_reuse` BEFORE UPDATE OF
  bridge_message_id, destination_tx_hash ON `chiliz_bridge_journal`
WHEN EXISTS (SELECT 1 FROM chiliz_bridge_transfers repeat WHERE
  (NEW.bridge_message_id IS NOT NULL AND repeat.bridge_message_id = NEW.bridge_message_id) OR
  (NEW.destination_tx_hash IS NOT NULL AND repeat.destination_tx_hash = NEW.destination_tx_hash))
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_legacy_repeat_reuse'); END;
