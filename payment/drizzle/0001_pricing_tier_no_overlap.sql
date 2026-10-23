-- Pricing tier bands for the same command, amount type and currency must not overlap while both are in effect.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "service_pricing_tiers" ADD CONSTRAINT "service_pricing_tiers_no_overlap"
  EXCLUDE USING gist (
    "service_command_id" WITH =,
    "amount_type" WITH =,
    "currency" WITH =,
    int8range("min_amount", "max_amount", '[]') WITH &&,
    tstzrange("effective_from", "effective_to") WITH &&
  );
