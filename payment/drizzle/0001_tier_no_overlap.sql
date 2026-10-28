-- Active tiers of the same command may not have overlapping amount ranges ([min, max), NULL = unbounded).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "tier_config" ADD CONSTRAINT "ex_tier_overlap"
  EXCLUDE USING gist (
    "service_command_id" WITH =,
    numrange("min_amount", "max_amount", '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');
