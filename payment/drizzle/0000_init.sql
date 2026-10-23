CREATE TABLE "ledger_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"postings" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_outbox_transfer_id_unique" UNIQUE("transfer_id"),
	CONSTRAINT "ledger_outbox_status_check" CHECK ("ledger_outbox"."status" in ('queued', 'done', 'dead'))
);
--> statement-breakpoint
CREATE TABLE "service_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"command" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"allow_partial" boolean DEFAULT false NOT NULL,
	"max_age_minutes" integer,
	"net_amount_add" text[] DEFAULT '{}' NOT NULL,
	"net_amount_subtract" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_commands_service_command_unique" UNIQUE("service_id","command"),
	CONSTRAINT "service_commands_command_check" CHECK ("service_commands"."command" in ('payment', 'refund', 'cancel')),
	CONSTRAINT "service_commands_status_check" CHECK ("service_commands"."status" in ('active', 'disabled')),
	CONSTRAINT "service_commands_net_types_check" CHECK ("service_commands"."net_amount_add" <@ array['selling_price', 'fee_from_customer', 'fee_from_partner', 'commission_to_agent_1', 'commission_to_partner', 'withholding_tax', 'discount', 'cash_back', 'cancellation_fee', 'commission_to_agent_2', 'purchasing_cost', 'vat', 'platform_commission', 'service_charge']::text[] and "service_commands"."net_amount_subtract" <@ array['selling_price', 'fee_from_customer', 'fee_from_partner', 'commission_to_agent_1', 'commission_to_partner', 'withholding_tax', 'discount', 'cash_back', 'cancellation_fee', 'commission_to_agent_2', 'purchasing_cost', 'vat', 'platform_commission', 'service_charge']::text[])
);
--> statement-breakpoint
CREATE TABLE "service_movement_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_command_id" uuid NOT NULL,
	"entry_no" integer NOT NULL,
	"side" text NOT NULL,
	"account" text NOT NULL,
	"amount_type" text NOT NULL,
	"allow_overdraft" boolean DEFAULT false NOT NULL,
	CONSTRAINT "service_movement_entries_command_entry_unique" UNIQUE("service_command_id","entry_no"),
	CONSTRAINT "service_movement_entries_side_check" CHECK ("service_movement_entries"."side" in ('debit', 'credit')),
	CONSTRAINT "service_movement_entries_amount_type_check" CHECK ("service_movement_entries"."amount_type" in ('amount', 'selling_price', 'fee_from_customer', 'fee_from_partner', 'commission_to_agent_1', 'commission_to_partner', 'withholding_tax', 'discount', 'cash_back', 'cancellation_fee', 'commission_to_agent_2', 'purchasing_cost', 'vat', 'platform_commission', 'net_amount', 'service_charge')),
	CONSTRAINT "service_movement_entries_overdraft_check" CHECK (not "service_movement_entries"."allow_overdraft" or "service_movement_entries"."account" not in ('{source}', '{destination}', '@world'))
);
--> statement-breakpoint
CREATE TABLE "service_pricing_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_command_id" uuid NOT NULL,
	"amount_type" text NOT NULL,
	"currency" text NOT NULL,
	"min_amount" bigint DEFAULT 0 NOT NULL,
	"max_amount" bigint,
	"calc_type" text NOT NULL,
	"base_amount_type" text DEFAULT 'amount' NOT NULL,
	"include_base" boolean DEFAULT false NOT NULL,
	"fixed_amount" bigint DEFAULT 0 NOT NULL,
	"percent_bps" integer DEFAULT 0 NOT NULL,
	"min_value" bigint,
	"max_value" bigint,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_pricing_tiers_amount_type_check" CHECK ("service_pricing_tiers"."amount_type" in ('selling_price', 'fee_from_customer', 'fee_from_partner', 'commission_to_agent_1', 'commission_to_partner', 'withholding_tax', 'discount', 'cash_back', 'cancellation_fee', 'commission_to_agent_2', 'purchasing_cost', 'vat', 'platform_commission', 'service_charge')),
	CONSTRAINT "service_pricing_tiers_currency_check" CHECK ("service_pricing_tiers"."currency" in ('USD', 'KHR')),
	CONSTRAINT "service_pricing_tiers_calc_type_check" CHECK ("service_pricing_tiers"."calc_type" in ('fixed', 'percent', 'fixed_plus_percent')),
	CONSTRAINT "service_pricing_tiers_base_check" CHECK ("service_pricing_tiers"."base_amount_type" in ('amount', 'selling_price', 'fee_from_customer', 'fee_from_partner', 'commission_to_agent_1', 'commission_to_partner', 'withholding_tax', 'discount', 'cash_back', 'cancellation_fee', 'commission_to_agent_2', 'purchasing_cost', 'vat', 'platform_commission', 'service_charge') and "service_pricing_tiers"."base_amount_type" <> "service_pricing_tiers"."amount_type"),
	CONSTRAINT "service_pricing_tiers_amounts_check" CHECK ("service_pricing_tiers"."min_amount" >= 0 and ("service_pricing_tiers"."max_amount" is null or "service_pricing_tiers"."max_amount" >= "service_pricing_tiers"."min_amount") and "service_pricing_tiers"."fixed_amount" >= 0 and "service_pricing_tiers"."percent_bps" between 0 and 10000),
	CONSTRAINT "service_pricing_tiers_effective_check" CHECK ("service_pricing_tiers"."effective_to" is null or "service_pricing_tiers"."effective_to" > "service_pricing_tiers"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_code" text NOT NULL,
	"service_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_service_code_unique" UNIQUE("service_code"),
	CONSTRAINT "services_status_check" CHECK ("services"."status" in ('active', 'suspended', 'inactive')),
	CONSTRAINT "services_code_check" CHECK ("services"."service_code" ~ '^[A-Z0-9_]{2,40}$')
);
--> statement-breakpoint
CREATE TABLE "transfer_amounts" (
	"transfer_id" uuid NOT NULL,
	"amount_type" text NOT NULL,
	"amount" bigint NOT NULL,
	"pricing_tier_id" uuid,
	CONSTRAINT "transfer_amounts_transfer_id_amount_type_pk" PRIMARY KEY("transfer_id","amount_type"),
	CONSTRAINT "transfer_amounts_amount_type_check" CHECK ("transfer_amounts"."amount_type" in ('amount', 'selling_price', 'fee_from_customer', 'fee_from_partner', 'commission_to_agent_1', 'commission_to_partner', 'withholding_tax', 'discount', 'cash_back', 'cancellation_fee', 'commission_to_agent_2', 'purchasing_cost', 'vat', 'platform_commission', 'net_amount', 'service_charge'))
);
--> statement-breakpoint
CREATE TABLE "transfer_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transfer_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"service_id" uuid,
	"service_command_id" uuid,
	"original_transfer_id" uuid,
	"source_customer_id" uuid,
	"source_account_id" uuid,
	"destination_customer_id" uuid,
	"destination_account_id" uuid,
	"currency" text NOT NULL,
	"asset" text NOT NULL,
	"amount" bigint NOT NULL,
	"source_net" bigint,
	"destination_net" bigint,
	"ledger_tx_id" bigint,
	"external_ref" text,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "transfers_type_external_ref_unique" UNIQUE("type","external_ref"),
	CONSTRAINT "transfers_type_check" CHECK ("transfers"."type" in ('payment', 'refund', 'cancel', 'topup')),
	CONSTRAINT "transfers_status_check" CHECK ("transfers"."status" in ('pending', 'posted', 'failed', 'reversed')),
	CONSTRAINT "transfers_currency_check" CHECK ("transfers"."currency" in ('USD', 'KHR')),
	CONSTRAINT "transfers_amount_check" CHECK ("transfers"."amount" > 0),
	CONSTRAINT "transfers_service_check" CHECK (("transfers"."type" = 'topup') = ("transfers"."service_command_id" is null)),
	CONSTRAINT "transfers_original_check" CHECK (("transfers"."type" in ('refund', 'cancel')) = ("transfers"."original_transfer_id" is not null)),
	CONSTRAINT "transfers_parties_check" CHECK (("transfers"."source_customer_id" is null) = ("transfers"."source_account_id" is null) and ("transfers"."destination_customer_id" is null) = ("transfers"."destination_account_id" is null) and ("transfers"."source_customer_id" is not null or "transfers"."destination_customer_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ledger_outbox" ADD CONSTRAINT "ledger_outbox_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_commands" ADD CONSTRAINT "service_commands_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_movement_entries" ADD CONSTRAINT "service_movement_entries_service_command_id_service_commands_id_fk" FOREIGN KEY ("service_command_id") REFERENCES "public"."service_commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_pricing_tiers" ADD CONSTRAINT "service_pricing_tiers_service_command_id_service_commands_id_fk" FOREIGN KEY ("service_command_id") REFERENCES "public"."service_commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_amounts" ADD CONSTRAINT "transfer_amounts_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_amounts" ADD CONSTRAINT "transfer_amounts_pricing_tier_id_service_pricing_tiers_id_fk" FOREIGN KEY ("pricing_tier_id") REFERENCES "public"."service_pricing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_events" ADD CONSTRAINT "transfer_events_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_service_command_id_service_commands_id_fk" FOREIGN KEY ("service_command_id") REFERENCES "public"."service_commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_original_transfer_id_transfers_id_fk" FOREIGN KEY ("original_transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_outbox_due_idx" ON "ledger_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "service_pricing_tiers_lookup_idx" ON "service_pricing_tiers" USING btree ("service_command_id","currency","amount_type");--> statement-breakpoint
CREATE INDEX "transfer_events_transfer_idx" ON "transfer_events" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfers_source_created_idx" ON "transfers" USING btree ("source_customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transfers_destination_created_idx" ON "transfers" USING btree ("destination_customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transfers_original_idx" ON "transfers" USING btree ("original_transfer_id");