CREATE TABLE `chiliz_bridge_canary_plans` (
	`bridge_id` text PRIMARY KEY NOT NULL,
	`plan_json` text NOT NULL,
	`plan_sha256` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`bridge_id`) REFERENCES `chiliz_bridge_journal`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_chiliz_bridge_canary_plan_json" CHECK(json_valid("chiliz_bridge_canary_plans"."plan_json") AND json_type("chiliz_bridge_canary_plans"."plan_json") = 'object' AND length("chiliz_bridge_canary_plans"."plan_json") BETWEEN 100 AND 30000),
	CONSTRAINT "chk_chiliz_bridge_canary_plan_sha" CHECK(length("chiliz_bridge_canary_plans"."plan_sha256") = 64 AND "chiliz_bridge_canary_plans"."plan_sha256" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_canary_plan_insert_bound` BEFORE INSERT ON `chiliz_bridge_canary_plans`
WHEN EXISTS (SELECT 1 FROM json_tree(NEW.plan_json)
  WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
  OR NOT EXISTS (
  SELECT 1 FROM chiliz_bridge_journal b
  WHERE b.id = NEW.bridge_id AND b.state = 'prepared' AND b.route_type = 'OFT'
    AND json_extract(NEW.plan_json, '$.sourceWallet') = b.source_wallet
    AND lower(json_extract(NEW.plan_json, '$.destinationTreasury')) = b.destination_treasury
    AND json_extract(NEW.plan_json, '$.sourceAmountAtomic') = b.source_amount_atomic
    AND json_extract(NEW.plan_json, '$.minimumDestinationWei') = b.minimum_destination_wei
    AND 'oft:' || json_extract(NEW.plan_json, '$.onchainQuoteDigestSha256') = b.quote_id
    AND json_extract(NEW.plan_json, '$.quoteExpiresAtMs') = b.quote_expires_at_ms
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_canary_plan_identity_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_canary_plan_no_update` BEFORE UPDATE ON `chiliz_bridge_canary_plans`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_canary_plan_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_canary_plan_no_delete` BEFORE DELETE ON `chiliz_bridge_canary_plans`
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_canary_plan_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_chiliz_bridge_canary_broadcast_requires_plan` BEFORE UPDATE OF state ON `chiliz_bridge_journal`
WHEN NEW.route_type = 'OFT' AND NEW.state = 'broadcast_attempted' AND NOT EXISTS (
  SELECT 1 FROM chiliz_bridge_canary_plans p WHERE p.bridge_id = NEW.id
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_canary_plan_missing'); END;
--> statement-breakpoint
-- Lane exclusion must be symmetric. The repeat coordinator already refuses
-- to stage while this legacy lane is active; this trigger prevents the legacy
-- one-shot lane from being armed after a repeat transfer has been staged.
CREATE TRIGGER `trg_chiliz_legacy_policy_repeat_lane_exclusion`
BEFORE UPDATE OF state, reserved_bridge_id ON `chiliz_bridge_policy`
WHEN NEW.state IN ('armed','reserved') AND EXISTS (
  SELECT 1 FROM chiliz_bridge_transfers
  WHERE state <> 'destination_finalized'
)
BEGIN SELECT RAISE(ABORT, 'chiliz_bridge_repeat_lane_active'); END;
