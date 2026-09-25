CREATE TABLE `chiliz_fee_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_event_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`launch_id` text NOT NULL,
	`reward_treasury` text NOT NULL,
	`source_signature` text NOT NULL,
	`source_slot` integer NOT NULL,
	`gross_amount_lamports` text NOT NULL,
	`reward_amount_lamports` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`fee_event_id`) REFERENCES `fee_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`launch_id`) REFERENCES `launch_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_fee_reservation_source_slot" CHECK("chiliz_fee_reservations"."source_slot" > 0),
	CONSTRAINT "chk_chiliz_fee_reservation_source_signature" CHECK(length("chiliz_fee_reservations"."source_signature") BETWEEN 64 AND 88),
	CONSTRAINT "chk_chiliz_fee_reservation_gross" CHECK("chiliz_fee_reservations"."gross_amount_lamports" GLOB '[1-9]*' AND "chiliz_fee_reservations"."gross_amount_lamports" NOT GLOB '*[^0-9]*' AND length("chiliz_fee_reservations"."gross_amount_lamports") <= 16),
	CONSTRAINT "chk_chiliz_fee_reservation_reward" CHECK("chiliz_fee_reservations"."reward_amount_lamports" GLOB '[1-9]*' AND "chiliz_fee_reservations"."reward_amount_lamports" NOT GLOB '*[^0-9]*' AND length("chiliz_fee_reservations"."reward_amount_lamports") <= 16)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_fee_reservation_event` ON `chiliz_fee_reservations` (`fee_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chiliz_fee_reservation_settlement` ON `chiliz_fee_reservations` (`settlement_id`);--> statement-breakpoint
CREATE INDEX `idx_chiliz_fee_reservation_launch` ON `chiliz_fee_reservations` (`launch_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_insert_eligible` BEFORE INSERT
  ON `chiliz_fee_reservations`
WHEN NEW.id <> 'chiliz:fee:' || NEW.fee_event_id OR NOT EXISTS (
  SELECT 1 FROM fee_events f
  JOIN settlements s ON s.fee_event_id = f.id
  JOIN launch_drafts l ON l.id = f.launch_id
  LEFT JOIN protocol_settings p ON p.key = 'sportpad_mint'
  WHERE f.id = NEW.fee_event_id AND s.id = NEW.settlement_id
    AND l.id = NEW.launch_id AND l.reward_chain = 'chiliz'
    AND l.reward_bps = 8000 AND l.buyback_bps = 2000
    AND l.status = 'mainnet_published' AND l.mainnet_verified_at IS NOT NULL
    AND l.mainnet_mint IS NOT NULL AND l.mainnet_reward_treasury = NEW.reward_treasury
    AND l.mainnet_fee_slot IS NOT NULL AND f.source_slot > l.mainnet_fee_slot
    AND (p.value IS NULL OR l.mainnet_mint <> p.value)
    AND f.state = 'reconciled'
    AND s.state IN ('reconciled', 'distributed', 'buyback_burned')
    AND f.source_signature = NEW.source_signature AND f.source_slot = NEW.source_slot
    AND f.id = f.source_signature || ':' || f.instruction_index
    AND f.gross_amount_atomic = NEW.gross_amount_lamports
    AND s.reward_amount_atomic = NEW.reward_amount_lamports
    AND s.reward_spent_atomic = '0' AND s.reward_swap_signature IS NULL
    AND f.gross_amount_atomic GLOB '[1-9]*'
    AND f.gross_amount_atomic NOT GLOB '*[^0-9]*'
    AND CAST(f.gross_amount_atomic AS INTEGER) BETWEEN 2 AND 1000000000000000
    AND s.reward_amount_atomic GLOB '[1-9]*'
    AND s.reward_amount_atomic NOT GLOB '*[^0-9]*'
    AND s.buyback_amount_atomic GLOB '[1-9]*'
    AND s.buyback_amount_atomic NOT GLOB '*[^0-9]*'
    AND CAST(s.reward_amount_atomic AS INTEGER) = CAST(f.gross_amount_atomic AS INTEGER) * 4 / 5
    -- A standalone Jupiter order below the existing 0.001 SOL reward-queue floor
    -- is not viable. Smaller events remain unreserved until fee batching exists.
    AND CAST(s.reward_amount_atomic AS INTEGER) >= 1000000
    AND CAST(s.buyback_amount_atomic AS INTEGER) = CAST(f.gross_amount_atomic AS INTEGER) - CAST(s.reward_amount_atomic AS INTEGER)
    AND NOT EXISTS (SELECT 1 FROM reward_swap_batch_sources src WHERE src.settlement_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM settlement_steps step WHERE step.settlement_id = s.id
      AND step.stage IN ('automatic_reward_chunk', 'reward_swap'))
    AND NOT EXISTS (SELECT 1 FROM transaction_intents intent WHERE intent.settlement_id = s.id
      AND intent.action IN ('reward_swap', 'solana_reward_purchase_automation'))
    AND NOT EXISTS (SELECT 1 FROM automation_jobs job WHERE job.entity_type = 'settlement'
      AND job.entity_id = s.id AND job.job_type = 'solana_reward_purchase')
)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_reservation_ineligible'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_update` BEFORE UPDATE
  ON `chiliz_fee_reservations`
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_reservation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_delete` BEFORE DELETE
  ON `chiliz_fee_reservations`
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_reservation_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_solana_batch` BEFORE INSERT
  ON `reward_swap_batch_sources`
WHEN EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = NEW.settlement_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_solana_batch_retarget` BEFORE UPDATE OF settlement_id
  ON `reward_swap_batch_sources`
WHEN EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = NEW.settlement_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_solana_step` BEFORE INSERT
  ON `settlement_steps`
WHEN NEW.stage IN ('automatic_reward_chunk', 'reward_swap')
  AND EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = NEW.settlement_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_solana_step_retarget` BEFORE UPDATE OF settlement_id, stage
  ON `settlement_steps`
WHEN NEW.stage IN ('automatic_reward_chunk', 'reward_swap')
  AND EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = NEW.settlement_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_solana_intent` BEFORE INSERT
  ON `transaction_intents`
WHEN NEW.action IN ('reward_swap', 'solana_reward_purchase_automation')
  AND EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = NEW.settlement_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_solana_intent_retarget` BEFORE UPDATE OF settlement_id, action
  ON `transaction_intents`
WHEN NEW.action IN ('reward_swap', 'solana_reward_purchase_automation')
  AND EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = NEW.settlement_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_solana_job` BEFORE INSERT
  ON `automation_jobs`
WHEN NEW.entity_type = 'settlement' AND NEW.job_type = 'solana_reward_purchase'
  AND EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = NEW.entity_id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_no_reward_progress` BEFORE UPDATE OF
  reward_spent_atomic, reward_swap_signature ON `settlements`
WHEN EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = OLD.id)
  AND (NEW.reward_spent_atomic <> OLD.reward_spent_atomic
    OR NEW.reward_swap_signature IS NOT OLD.reward_swap_signature)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_already_reserved'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_source_immutable` BEFORE UPDATE OF
  id, fee_event_id, reward_amount_atomic, buyback_amount_atomic ON `settlements`
WHEN EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.settlement_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_source_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_event_immutable` BEFORE UPDATE OF
  id, launch_id, source_signature, instruction_index, source_slot, gross_amount_atomic, state
  ON `fee_events`
WHEN EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.fee_event_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_source_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_fee_reservation_launch_identity_immutable` BEFORE UPDATE OF
  reward_chain, reward_bps, buyback_bps, mainnet_reward_treasury, mainnet_mint, mainnet_fee_slot
  ON `launch_drafts`
WHEN EXISTS (SELECT 1 FROM chiliz_fee_reservations r WHERE r.launch_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'chiliz_fee_source_immutable'); END;
