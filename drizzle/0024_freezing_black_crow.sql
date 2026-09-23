CREATE TABLE `chiliz_bridge_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_key` text NOT NULL,
	`source_chain` text NOT NULL,
	`destination_chain_id` integer NOT NULL,
	`source_mint` text NOT NULL,
	`destination_asset` text NOT NULL,
	`source_wallet` text NOT NULL,
	`destination_treasury` text NOT NULL,
	`source_amount_atomic` text NOT NULL,
	`minimum_destination_wei` text NOT NULL,
	`quote_id` text NOT NULL,
	`quote_expires_at_ms` integer NOT NULL,
	`route_type` text NOT NULL,
	`signed_transaction_base64` text NOT NULL,
	`signed_transaction_sha256` text NOT NULL,
	`source_signature` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
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
	FOREIGN KEY (`policy_key`) REFERENCES `chiliz_bridge_policy`(`key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_bridge_source_chain" CHECK("chiliz_bridge_journal"."source_chain" = 'solana'),
	CONSTRAINT "chk_chiliz_bridge_destination_chain" CHECK("chiliz_bridge_journal"."destination_chain_id" = 88888),
	CONSTRAINT "chk_chiliz_bridge_source_mint" CHECK("chiliz_bridge_journal"."source_mint" = '6eftxVbSAunVEoxUWdGhPdxg5UdsJ8Wkwy5w5YFuxouw'),
	CONSTRAINT "chk_chiliz_bridge_destination_asset" CHECK("chiliz_bridge_journal"."destination_asset" = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
	CONSTRAINT "chk_chiliz_bridge_route" CHECK("chiliz_bridge_journal"."route_type" IN ('OFT', 'OFT_V2')),
	CONSTRAINT "chk_chiliz_bridge_state" CHECK("chiliz_bridge_journal"."state" IN ('prepared', 'broadcast_attempted', 'source_finalized', 'destination_finalized', 'held')),
	CONSTRAINT "chk_chiliz_bridge_source_amount" CHECK("chiliz_bridge_journal"."source_amount_atomic" GLOB '[1-9]*' AND "chiliz_bridge_journal"."source_amount_atomic" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "chk_chiliz_bridge_min_destination" CHECK("chiliz_bridge_journal"."minimum_destination_wei" GLOB '[1-9]*' AND "chiliz_bridge_journal"."minimum_destination_wei" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "chk_chiliz_bridge_sha256" CHECK(length("chiliz_bridge_journal"."signed_transaction_sha256") = 64 AND "chiliz_bridge_journal"."signed_transaction_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_chiliz_bridge_signature" CHECK(length("chiliz_bridge_journal"."source_signature") BETWEEN 64 AND 88)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_journal_policy` ON `chiliz_bridge_journal` (`policy_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_journal_quote` ON `chiliz_bridge_journal` (`quote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_journal_signature` ON `chiliz_bridge_journal` (`source_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_journal_signed_sha256` ON `chiliz_bridge_journal` (`signed_transaction_sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_journal_message` ON `chiliz_bridge_journal` (`bridge_message_id`) WHERE "chiliz_bridge_journal"."bridge_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_journal_destination_tx` ON `chiliz_bridge_journal` (`destination_tx_hash`) WHERE "chiliz_bridge_journal"."destination_tx_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_chiliz_bridge_journal_state` ON `chiliz_bridge_journal` (`state`);--> statement-breakpoint
CREATE TABLE `chiliz_bridge_policy` (
	`key` text PRIMARY KEY NOT NULL,
	`source_wallet` text NOT NULL,
	`destination_treasury` text NOT NULL,
	`max_source_amount_atomic` text NOT NULL,
	`reserved_bridge_id` text,
	`state` text DEFAULT 'paused' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chk_chiliz_bridge_policy_key" CHECK("chiliz_bridge_policy"."key" = 'initial'),
	CONSTRAINT "chk_chiliz_bridge_policy_state" CHECK("chiliz_bridge_policy"."state" IN ('paused', 'armed', 'reserved')),
	CONSTRAINT "chk_chiliz_bridge_policy_reservation" CHECK("chiliz_bridge_policy"."state" <> 'reserved' OR "chiliz_bridge_policy"."reserved_bridge_id" IS NOT NULL),
	CONSTRAINT "chk_chiliz_bridge_policy_unreserved" CHECK("chiliz_bridge_policy"."state" <> 'armed' OR "chiliz_bridge_policy"."reserved_bridge_id" IS NULL),
	CONSTRAINT "chk_chiliz_bridge_policy_source" CHECK(length("chiliz_bridge_policy"."source_wallet") BETWEEN 32 AND 44),
	CONSTRAINT "chk_chiliz_bridge_policy_destination" CHECK(length("chiliz_bridge_policy"."destination_treasury") = 42 AND substr("chiliz_bridge_policy"."destination_treasury",1,2) = '0x' AND substr("chiliz_bridge_policy"."destination_treasury",3) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_chiliz_bridge_policy_cap" CHECK("chiliz_bridge_policy"."max_source_amount_atomic" GLOB '[1-9]*' AND "chiliz_bridge_policy"."max_source_amount_atomic" NOT GLOB '*[^0-9]*' AND (length("chiliz_bridge_policy"."max_source_amount_atomic") < 10 OR (length("chiliz_bridge_policy"."max_source_amount_atomic") = 10 AND "chiliz_bridge_policy"."max_source_amount_atomic" <= '1000000000')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_policy_reservation` ON `chiliz_bridge_policy` (`reserved_bridge_id`) WHERE "chiliz_bridge_policy"."reserved_bridge_id" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_policy_identity_immutable` BEFORE UPDATE OF
  key, source_wallet, destination_treasury, max_source_amount_atomic
  ON `chiliz_bridge_policy`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_policy_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_policy_reservation_immutable` BEFORE UPDATE OF
  reserved_bridge_id ON `chiliz_bridge_policy`
WHEN OLD.reserved_bridge_id IS NOT NULL AND
  NEW.reserved_bridge_id IS NOT OLD.reserved_bridge_id
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_policy_reservation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_policy_state_transition` BEFORE UPDATE OF state
  ON `chiliz_bridge_policy`
WHEN NOT (
  NEW.state = OLD.state OR
  (OLD.state = 'paused' AND OLD.reserved_bridge_id IS NULL AND NEW.state = 'armed') OR
  (OLD.state = 'armed' AND NEW.state IN ('paused', 'reserved')) OR
  (OLD.state = 'reserved' AND NEW.state = 'paused')
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_policy_state_transition'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_policy_no_delete` BEFORE DELETE ON `chiliz_bridge_policy`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_policy_no_delete'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_intent_immutable` BEFORE UPDATE OF
  id, policy_key, source_chain, destination_chain_id, source_mint,
  destination_asset, source_wallet, destination_treasury,
  source_amount_atomic, minimum_destination_wei, quote_id,
  quote_expires_at_ms, route_type, signed_transaction_base64,
  signed_transaction_sha256, source_signature
  ON `chiliz_bridge_journal`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_intent_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_state_transition` BEFORE UPDATE OF state
  ON `chiliz_bridge_journal`
WHEN NOT (
  NEW.state = OLD.state OR
  (OLD.state = 'prepared' AND NEW.state = 'broadcast_attempted') OR
  (OLD.state = 'broadcast_attempted' AND NEW.state IN ('source_finalized', 'held')) OR
  (OLD.state = 'source_finalized' AND NEW.state IN ('destination_finalized', 'held')) OR
  (OLD.state = 'held' AND NEW.state IN ('source_finalized', 'destination_finalized'))
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_state_transition'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_evidence_immutable` BEFORE UPDATE OF
  broadcast_attempted_at_ms, source_finalized_slot, source_evidence_json,
  bridge_message_id, destination_tx_hash, destination_finalized_block,
  destination_received_wei, destination_evidence_json
  ON `chiliz_bridge_journal`
WHEN (OLD.broadcast_attempted_at_ms IS NOT NULL AND
      NEW.broadcast_attempted_at_ms IS NOT OLD.broadcast_attempted_at_ms) OR
     (OLD.source_finalized_slot IS NOT NULL AND
      NEW.source_finalized_slot IS NOT OLD.source_finalized_slot) OR
     (OLD.source_evidence_json IS NOT NULL AND
      NEW.source_evidence_json IS NOT OLD.source_evidence_json) OR
     (OLD.bridge_message_id IS NOT NULL AND
      NEW.bridge_message_id IS NOT OLD.bridge_message_id) OR
     (OLD.destination_tx_hash IS NOT NULL AND
      NEW.destination_tx_hash IS NOT OLD.destination_tx_hash) OR
     (OLD.destination_finalized_block IS NOT NULL AND
      NEW.destination_finalized_block IS NOT OLD.destination_finalized_block) OR
     (OLD.destination_received_wei IS NOT NULL AND
      NEW.destination_received_wei IS NOT OLD.destination_received_wei) OR
     (OLD.destination_evidence_json IS NOT NULL AND
      NEW.destination_evidence_json IS NOT OLD.destination_evidence_json)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_evidence_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_no_delete` BEFORE DELETE ON `chiliz_bridge_journal`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_no_delete'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_policy_insert_paused` BEFORE INSERT
  ON `chiliz_bridge_policy`
WHEN NEW.state <> 'paused' OR NEW.reserved_bridge_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_policy_insert_paused'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_insert_prepared` BEFORE INSERT
  ON `chiliz_bridge_journal`
WHEN NEW.state <> 'prepared' OR NEW.broadcast_attempted_at_ms IS NOT NULL OR
  NEW.source_finalized_slot IS NOT NULL OR NEW.source_evidence_json IS NOT NULL OR
  NEW.bridge_message_id IS NOT NULL OR NEW.destination_tx_hash IS NOT NULL OR
  NEW.destination_finalized_block IS NOT NULL OR
  NEW.destination_received_wei IS NOT NULL OR NEW.destination_evidence_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_insert_prepared'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_state_shape` BEFORE UPDATE
  ON `chiliz_bridge_journal`
WHEN
  (NEW.state = 'prepared' AND
    (NEW.broadcast_attempted_at_ms IS NOT NULL OR
     NEW.source_finalized_slot IS NOT NULL OR NEW.source_evidence_json IS NOT NULL OR
     NEW.bridge_message_id IS NOT NULL OR NEW.destination_tx_hash IS NOT NULL OR
     NEW.destination_finalized_block IS NOT NULL OR
     NEW.destination_received_wei IS NOT NULL OR NEW.destination_evidence_json IS NOT NULL)) OR
  (NEW.state = 'broadcast_attempted' AND
    (NEW.broadcast_attempted_at_ms IS NULL OR
     NEW.source_finalized_slot IS NOT NULL OR NEW.source_evidence_json IS NOT NULL OR
     NEW.bridge_message_id IS NOT NULL OR NEW.destination_tx_hash IS NOT NULL OR
     NEW.destination_finalized_block IS NOT NULL OR
     NEW.destination_received_wei IS NOT NULL OR NEW.destination_evidence_json IS NOT NULL)) OR
  (NEW.state IN ('source_finalized', 'destination_finalized') AND
    (NEW.broadcast_attempted_at_ms IS NULL OR NEW.source_finalized_slot IS NULL OR
     NEW.source_evidence_json IS NULL OR NEW.bridge_message_id IS NULL)) OR
  (NEW.state = 'held' AND
    (NEW.broadcast_attempted_at_ms IS NULL OR
     ((NEW.source_finalized_slot IS NULL OR NEW.source_evidence_json IS NULL OR
       NEW.bridge_message_id IS NULL) AND
      (NEW.source_finalized_slot IS NOT NULL OR NEW.source_evidence_json IS NOT NULL OR
       NEW.bridge_message_id IS NOT NULL)) OR
     NEW.destination_tx_hash IS NOT NULL OR
     NEW.destination_finalized_block IS NOT NULL OR
     NEW.destination_received_wei IS NOT NULL OR NEW.destination_evidence_json IS NOT NULL)) OR
  (NEW.state <> 'destination_finalized' AND
    (NEW.destination_tx_hash IS NOT NULL OR
     NEW.destination_finalized_block IS NOT NULL OR
     NEW.destination_received_wei IS NOT NULL OR NEW.destination_evidence_json IS NOT NULL)) OR
  (NEW.state = 'destination_finalized' AND
    (NEW.destination_tx_hash IS NULL OR NEW.destination_finalized_block IS NULL OR
     NEW.destination_received_wei IS NULL OR NEW.destination_evidence_json IS NULL))
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_state_shape'); END;
