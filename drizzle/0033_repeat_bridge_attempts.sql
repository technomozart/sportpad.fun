CREATE TABLE `chiliz_bridge_attempts` (
	`bridge_id` text NOT NULL,
	`attempt_sequence` integer NOT NULL,
	`quote_id` text NOT NULL,
	`quote_expires_at_ms` integer NOT NULL,
	`signed_transaction_base64` text NOT NULL,
	`signed_transaction_sha256` text NOT NULL,
	`source_signature` text NOT NULL,
	`plan_json` text NOT NULL,
	`plan_sha256` text NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`prepared_at_ms` integer NOT NULL,
	`abandoned_at_ms` integer,
	`claimed_at_ms` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`bridge_id`, `attempt_sequence`),
	FOREIGN KEY (`bridge_id`) REFERENCES `chiliz_bridge_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_bridge_attempts_sequence" CHECK("chiliz_bridge_attempts"."attempt_sequence" >= 0),
	CONSTRAINT "chk_chiliz_bridge_attempts_quote" CHECK(length("chiliz_bridge_attempts"."quote_id") BETWEEN 4 AND 256 AND "chiliz_bridge_attempts"."quote_expires_at_ms" > "chiliz_bridge_attempts"."prepared_at_ms" AND "chiliz_bridge_attempts"."prepared_at_ms" > 0),
	CONSTRAINT "chk_chiliz_bridge_attempts_signed" CHECK(length("chiliz_bridge_attempts"."signed_transaction_base64") BETWEEN 100 AND 4096 AND length("chiliz_bridge_attempts"."signed_transaction_sha256") = 64 AND "chiliz_bridge_attempts"."signed_transaction_sha256" NOT GLOB '*[^0-9a-f]*' AND length("chiliz_bridge_attempts"."source_signature") BETWEEN 64 AND 88),
	CONSTRAINT "chk_chiliz_bridge_attempts_plan" CHECK(json_valid("chiliz_bridge_attempts"."plan_json") AND json_type("chiliz_bridge_attempts"."plan_json") = 'object' AND length("chiliz_bridge_attempts"."plan_json") BETWEEN 100 AND 30000 AND length("chiliz_bridge_attempts"."plan_sha256") = 64 AND "chiliz_bridge_attempts"."plan_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_chiliz_bridge_attempts_state" CHECK(("chiliz_bridge_attempts"."state" = 'prepared' AND "chiliz_bridge_attempts"."abandoned_at_ms" IS NULL AND "chiliz_bridge_attempts"."claimed_at_ms" IS NULL) OR ("chiliz_bridge_attempts"."state" = 'abandoned_unbroadcast' AND "chiliz_bridge_attempts"."abandoned_at_ms" > "chiliz_bridge_attempts"."quote_expires_at_ms" AND "chiliz_bridge_attempts"."claimed_at_ms" IS NULL) OR ("chiliz_bridge_attempts"."state" = 'claimed' AND "chiliz_bridge_attempts"."claimed_at_ms" > 0 AND "chiliz_bridge_attempts"."claimed_at_ms" < "chiliz_bridge_attempts"."quote_expires_at_ms" AND "chiliz_bridge_attempts"."abandoned_at_ms" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_attempts_quote` ON `chiliz_bridge_attempts` (`quote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_attempts_signature` ON `chiliz_bridge_attempts` (`source_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_attempts_sha256` ON `chiliz_bridge_attempts` (`signed_transaction_sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_bridge_attempts_one_prepared` ON `chiliz_bridge_attempts` (`bridge_id`) WHERE "chiliz_bridge_attempts"."state" = 'prepared';
--> statement-breakpoint
-- A signed attempt is never an instruction to broadcast. No signed bytes may
-- leave the server until the matching bridge is sealed and claimed in ONE D1
-- batch. The bridge stays collecting through all unbroadcast requotes.
CREATE TRIGGER `trg_chiliz_bridge_attempt_insert_backed` BEFORE INSERT
  ON `chiliz_bridge_attempts`
WHEN NEW.state <> 'prepared' OR NEW.abandoned_at_ms IS NOT NULL
  OR NEW.claimed_at_ms IS NOT NULL
  OR NEW.quote_expires_at_ms <= NEW.prepared_at_ms + 30000
  OR ABS(NEW.prepared_at_ms - unixepoch('now') * 1000) > 30000
  OR NEW.quote_id <> 'oft:' || json_extract(NEW.plan_json,'$.onchainQuoteDigestSha256')
  OR json_extract(NEW.plan_json,'$.quoteExpiresAtMs') <> NEW.quote_expires_at_ms
  OR json_extract(NEW.plan_json,'$.executionReady') <> 0
  OR length(json_extract(NEW.plan_json,'$.expectedMessageSha256')) <> 64
  OR json_extract(NEW.plan_json,'$.lastValidBlockHeight') <= 0
  OR NEW.attempt_sequence <> COALESCE((SELECT MAX(prior.attempt_sequence) + 1
    FROM chiliz_bridge_attempts prior WHERE prior.bridge_id = NEW.bridge_id),0)
  OR EXISTS (SELECT 1 FROM chiliz_bridge_journal legacy WHERE
    legacy.quote_id = NEW.quote_id OR
    legacy.source_signature = NEW.source_signature OR
    legacy.signed_transaction_sha256 = NEW.signed_transaction_sha256)
  OR NOT EXISTS (
    SELECT 1 FROM chiliz_bridge_transfers b
    WHERE b.id = NEW.bridge_id AND b.state = 'collecting'
      AND b.quote_id IS NULL AND b.source_signature IS NULL
      AND b.broadcast_attempted_at_ms IS NULL
      AND json_extract(NEW.plan_json,'$.sourceWallet') = b.source_wallet
      AND lower(json_extract(NEW.plan_json,'$.destinationTreasury')) = b.destination_treasury
      AND json_extract(NEW.plan_json,'$.sourceMint') = b.source_mint
      AND json_extract(NEW.plan_json,'$.sourceAmountAtomic') = b.source_amount_atomic
      AND json_extract(NEW.plan_json,'$.minimumDestinationWei') = b.minimum_destination_wei
      AND b.source_amount_atomic = CAST(COALESCE((
        SELECT SUM(CAST(a.amount_atomic AS INTEGER)) FROM chiliz_bridge_allocations a
        WHERE a.bridge_id = b.id),0) AS TEXT)
  )
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_attempt_unbacked'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_attempt_immutable` BEFORE UPDATE OF
  bridge_id, attempt_sequence, quote_id, quote_expires_at_ms,
  signed_transaction_base64, signed_transaction_sha256, source_signature,
  plan_json, plan_sha256, prepared_at_ms, created_at
  ON `chiliz_bridge_attempts`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_attempt_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_attempt_one_way` BEFORE UPDATE
  ON `chiliz_bridge_attempts`
WHEN NOT (
  (OLD.state = 'prepared' AND NEW.state = 'abandoned_unbroadcast'
    AND OLD.quote_expires_at_ms < unixepoch('now') * 1000
    AND NEW.abandoned_at_ms > OLD.quote_expires_at_ms
    AND NEW.abandoned_at_ms <= unixepoch('now') * 1000 + 30000
    AND NEW.claimed_at_ms IS NULL
    AND EXISTS (SELECT 1 FROM chiliz_bridge_transfers b
      WHERE b.id = OLD.bridge_id AND b.state = 'collecting'
        AND b.source_signature IS NULL AND b.broadcast_attempted_at_ms IS NULL))
  OR (OLD.state = 'prepared' AND NEW.state = 'claimed'
    AND NEW.abandoned_at_ms IS NULL
    AND EXISTS (SELECT 1 FROM chiliz_bridge_transfers b
      WHERE b.id = OLD.bridge_id AND b.state = 'broadcast_unknown'
        AND b.quote_id = OLD.quote_id
        AND b.signed_transaction_sha256 = OLD.signed_transaction_sha256
        AND b.source_signature = OLD.source_signature
        AND b.broadcast_attempted_at_ms = NEW.claimed_at_ms))
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_attempt_invalid_transition'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_attempt_no_delete` BEFORE DELETE
  ON `chiliz_bridge_attempts`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_attempt_immutable'); END;
--> statement-breakpoint
-- Additional fail-closed fence on top of the 0029 one-way state trigger.
-- The API must execute collecting->prepared->broadcast_unknown plus attempt
-- prepared->claimed in one transactional D1 batch, then assert the final row.
CREATE TRIGGER `trg_chiliz_bridge_transfer_attempt_required` BEFORE UPDATE OF state
  ON `chiliz_bridge_transfers`
WHEN (OLD.state = 'collecting' AND NEW.state = 'prepared')
  OR (OLD.state = 'prepared' AND NEW.state = 'broadcast_unknown')
BEGIN
  SELECT RAISE(ABORT, 'chiliz_bridge_attempt_missing_or_expired')
  WHERE NOT EXISTS (
    SELECT 1 FROM chiliz_bridge_attempts a
    WHERE a.bridge_id = OLD.id AND a.state = 'prepared'
      AND a.quote_id = NEW.quote_id
      AND a.quote_expires_at_ms = NEW.quote_expires_at_ms
      AND a.signed_transaction_base64 = NEW.signed_transaction_base64
      AND a.signed_transaction_sha256 = NEW.signed_transaction_sha256
      AND a.source_signature = NEW.source_signature
      AND a.quote_expires_at_ms > unixepoch('now') * 1000 + 30000
      AND ((OLD.state = 'collecting' AND NEW.broadcast_attempted_at_ms IS NULL)
        OR (OLD.state = 'prepared' AND NEW.broadcast_attempted_at_ms > 0
          AND ABS(NEW.broadcast_attempted_at_ms - unixepoch('now') * 1000) <= 30000))
  );
END;
--> statement-breakpoint
-- Superseded signed bytes remain reserved across the legacy one-shot lane.
CREATE TRIGGER `trg_chiliz_legacy_bridge_no_attempt_reuse_insert` BEFORE INSERT
  ON `chiliz_bridge_journal`
WHEN EXISTS (SELECT 1 FROM chiliz_bridge_attempts a WHERE
  a.quote_id = NEW.quote_id OR a.source_signature = NEW.source_signature OR
  a.signed_transaction_sha256 = NEW.signed_transaction_sha256)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_attempt_legacy_reuse'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_legacy_bridge_no_attempt_reuse_update` BEFORE UPDATE OF
  quote_id, source_signature, signed_transaction_sha256
  ON `chiliz_bridge_journal`
WHEN EXISTS (SELECT 1 FROM chiliz_bridge_attempts a WHERE
  a.quote_id = NEW.quote_id OR a.source_signature = NEW.source_signature OR
  a.signed_transaction_sha256 = NEW.signed_transaction_sha256)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_attempt_legacy_reuse'); END;
