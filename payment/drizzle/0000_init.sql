CREATE TYPE "public"."calc_method" AS ENUM('FIXED', 'FORMULA');--> statement-breakpoint
CREATE TYPE "public"."command_type" AS ENUM('PAYMENT', 'REFUND', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."config_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."ledger_step" AS ENUM('RESERVE', 'SETTLE', 'REVERT', 'RELEASE');--> statement-breakpoint
CREATE TYPE "public"."ledger_tx_status" AS ENUM('PLANNED', 'POSTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."movement_status" AS ENUM('PENDING', 'POSTED', 'FAILED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."spi_auth_type" AS ENUM('NONE', 'API_KEY', 'BASIC', 'OAUTH2', 'MTLS');--> statement-breakpoint
CREATE TYPE "public"."spi_protocol" AS ENUM('REST', 'SOAP', 'ISO8583', 'ISO20022');--> statement-breakpoint
CREATE TYPE "public"."spi_trigger" AS ENUM('PRE_PAYMENT', 'POST_PAYMENT', 'NOTIFICATION');--> statement-breakpoint
CREATE TYPE "public"."spi_type" AS ENUM('INTERNAL', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."stock_role" AS ENUM('PAYER', 'PAYEE', 'SPECIFIC');--> statement-breakpoint
CREATE TABLE "amount_type" (
	"code" varchar(30) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "chk_amount_type_code" CHECK ("amount_type"."code" ~ '^[A-Z][A-Z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "balance_movement_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_config_id" uuid NOT NULL,
	"movement_sequence" smallint NOT NULL,
	"amount_type" varchar(30) NOT NULL,
	"from_stock_role" "stock_role" NOT NULL,
	"from_stock_id" uuid,
	"to_stock_role" "stock_role" NOT NULL,
	"to_stock_id" uuid,
	CONSTRAINT "uq_movement_sequence" UNIQUE("tier_config_id","movement_sequence"),
	CONSTRAINT "chk_from_stock" CHECK (("balance_movement_config"."from_stock_role" = 'SPECIFIC') = ("balance_movement_config"."from_stock_id" IS NOT NULL)),
	CONSTRAINT "chk_to_stock" CHECK (("balance_movement_config"."to_stock_role" = 'SPECIFIC') = ("balance_movement_config"."to_stock_id" IS NOT NULL)),
	CONSTRAINT "chk_not_same_stock" CHECK (NOT ("balance_movement_config"."from_stock_role" = "balance_movement_config"."to_stock_role" AND "balance_movement_config"."from_stock_role" <> 'SPECIFIC')
        AND ("balance_movement_config"."from_stock_id" IS NULL OR "balance_movement_config"."to_stock_id" IS NULL OR "balance_movement_config"."from_stock_id" <> "balance_movement_config"."to_stock_id"))
);
--> statement-breakpoint
CREATE TABLE "payment_order_amount" (
	"payment_order_id" uuid NOT NULL,
	"amount_type" varchar(30) NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	CONSTRAINT "payment_order_amount_payment_order_id_amount_type_pk" PRIMARY KEY("payment_order_id","amount_type"),
	CONSTRAINT "chk_order_amount_non_negative" CHECK ("payment_order_amount"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_order_balance_movement" (
	"payment_order_id" uuid NOT NULL,
	"movement_sequence" smallint NOT NULL,
	"amount_type" varchar(30) NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"from_stock_id" uuid NOT NULL,
	"to_stock_id" uuid NOT NULL,
	"status" "movement_status" DEFAULT 'PENDING' NOT NULL,
	"core_reference" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_order_balance_movement_payment_order_id_movement_sequence_pk" PRIMARY KEY("payment_order_id","movement_sequence"),
	CONSTRAINT "chk_movement_amount" CHECK ("payment_order_balance_movement"."amount" > 0),
	CONSTRAINT "chk_movement_stocks" CHECK ("payment_order_balance_movement"."from_stock_id" <> "payment_order_balance_movement"."to_stock_id")
);
--> statement-breakpoint
CREATE TABLE "payment_order_ledger_tx" (
	"payment_order_id" uuid NOT NULL,
	"step" "ledger_step" NOT NULL,
	"postings" jsonb NOT NULL,
	"numscript" text,
	"status" "ledger_tx_status" DEFAULT 'PLANNED' NOT NULL,
	"ledger_tx_id" bigint,
	"failure_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_order_ledger_tx_payment_order_id_step_pk" PRIMARY KEY("payment_order_id","step")
);
--> statement-breakpoint
CREATE TABLE "payment_order_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_order_id" uuid NOT NULL,
	"from_status" "payment_status",
	"to_status" "payment_status" NOT NULL,
	"reason_code" varchar(20),
	"changed_by" varchar(64) NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_reference" varchar(35) NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"external_reference" varchar(64),
	"service_id" uuid NOT NULL,
	"service_command_id" uuid NOT NULL,
	"tier_config_id" uuid,
	"original_order_id" uuid,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"status_reason_code" varchar(20),
	"customer_id" uuid NOT NULL,
	"payer_account_id" uuid NOT NULL,
	"payer_name" varchar(140) NOT NULL,
	"payee_account_id" uuid NOT NULL,
	"payee_name" varchar(140),
	"amount" numeric(20, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_orders_order_reference_unique" UNIQUE("order_reference"),
	CONSTRAINT "uq_idempotency" UNIQUE("customer_id","idempotency_key"),
	CONSTRAINT "chk_not_self_reference" CHECK ("payment_orders"."original_order_id" <> "payment_orders"."id"),
	CONSTRAINT "chk_order_amount" CHECK ("payment_orders"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_group_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(140) NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "config_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_code_unique" UNIQUE("code"),
	CONSTRAINT "uq_service_currency" UNIQUE("id","currency")
);
--> statement-breakpoint
CREATE TABLE "service_command" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"command_type" "command_type" NOT NULL,
	"status" "config_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_service_command" UNIQUE("service_id","command_type")
);
--> statement-breakpoint
CREATE TABLE "service_command_spi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_command_id" uuid NOT NULL,
	"spi_id" uuid NOT NULL,
	"trigger_stage" "spi_trigger" NOT NULL,
	"execution_sequence" smallint NOT NULL,
	"spi_operation" varchar(200) NOT NULL,
	"status" "config_status" DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "uq_command_spi_sequence" UNIQUE("service_command_id","trigger_stage","execution_sequence")
);
--> statement-breakpoint
CREATE TABLE "service_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(140) NOT NULL,
	"description" varchar(255),
	"status" "config_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(140) NOT NULL,
	"spi_type" "spi_type" NOT NULL,
	"status" "config_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spi_code_unique" UNIQUE("code"),
	CONSTRAINT "uq_spi_type" UNIQUE("id","spi_type")
);
--> statement-breakpoint
CREATE TABLE "spi_external_config" (
	"spi_id" uuid PRIMARY KEY NOT NULL,
	"spi_type" "spi_type" DEFAULT 'EXTERNAL' NOT NULL,
	"base_url" varchar(500) NOT NULL,
	"protocol" "spi_protocol" NOT NULL,
	"auth_type" "spi_auth_type" NOT NULL,
	"credential_ref" varchar(200),
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"max_retries" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "chk_spi_external_type" CHECK ("spi_external_config"."spi_type" = 'EXTERNAL'),
	CONSTRAINT "chk_spi_credential" CHECK (("spi_external_config"."auth_type" = 'NONE') = ("spi_external_config"."credential_ref" IS NULL)),
	CONSTRAINT "chk_spi_external_timeout" CHECK ("spi_external_config"."timeout_ms" > 0),
	CONSTRAINT "chk_spi_external_retries" CHECK ("spi_external_config"."max_retries" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spi_internal_config" (
	"spi_id" uuid PRIMARY KEY NOT NULL,
	"spi_type" "spi_type" DEFAULT 'INTERNAL' NOT NULL,
	"handler_name" varchar(140) NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	CONSTRAINT "chk_spi_internal_type" CHECK ("spi_internal_config"."spi_type" = 'INTERNAL'),
	CONSTRAINT "chk_spi_internal_timeout" CHECK ("spi_internal_config"."timeout_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "tier_amount_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_config_id" uuid NOT NULL,
	"amount_type" varchar(30) NOT NULL,
	"calc_sequence" smallint NOT NULL,
	"calc_method" "calc_method" NOT NULL,
	"base_amount_type" varchar(30),
	"fixed_value" numeric(20, 2),
	"percentage" numeric(9, 6),
	"formula_expression" varchar(500),
	"min_value" numeric(20, 2),
	"max_value" numeric(20, 2),
	CONSTRAINT "uq_tier_amount_type" UNIQUE("tier_config_id","amount_type"),
	CONSTRAINT "uq_tier_calc_sequence" UNIQUE("tier_config_id","calc_sequence"),
	CONSTRAINT "chk_rule_not_amount" CHECK ("tier_amount_rule"."amount_type" <> 'AMOUNT'),
	CONSTRAINT "chk_rule_fixed" CHECK ("tier_amount_rule"."calc_method" <> 'FIXED' OR (
        "tier_amount_rule"."formula_expression" IS NULL
        AND ("tier_amount_rule"."fixed_value" IS NOT NULL OR "tier_amount_rule"."percentage" IS NOT NULL)
        AND ("tier_amount_rule"."percentage" IS NULL) = ("tier_amount_rule"."base_amount_type" IS NULL)
        AND ("tier_amount_rule"."base_amount_type" IS NULL OR "tier_amount_rule"."base_amount_type" <> "tier_amount_rule"."amount_type")
      )),
	CONSTRAINT "chk_rule_formula" CHECK ("tier_amount_rule"."calc_method" <> 'FORMULA' OR (
        "tier_amount_rule"."formula_expression" IS NOT NULL
        AND "tier_amount_rule"."formula_expression" ~ '^[A-Z0-9_ .+\-*/()]+$'
        AND "tier_amount_rule"."base_amount_type" IS NULL AND "tier_amount_rule"."fixed_value" IS NULL AND "tier_amount_rule"."percentage" IS NULL
      )),
	CONSTRAINT "chk_rule_minmax" CHECK ("tier_amount_rule"."min_value" IS NULL OR "tier_amount_rule"."max_value" IS NULL OR "tier_amount_rule"."max_value" >= "tier_amount_rule"."min_value")
);
--> statement-breakpoint
CREATE TABLE "tier_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_command_id" uuid NOT NULL,
	"min_amount" numeric(20, 2),
	"max_amount" numeric(20, 2),
	"status" "config_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_tier_range" CHECK (("tier_config"."min_amount" IS NULL OR "tier_config"."min_amount" >= 0) AND ("tier_config"."min_amount" IS NULL OR "tier_config"."max_amount" IS NULL OR "tier_config"."max_amount" > "tier_config"."min_amount"))
);
--> statement-breakpoint
ALTER TABLE "balance_movement_config" ADD CONSTRAINT "balance_movement_config_tier_config_id_tier_config_id_fk" FOREIGN KEY ("tier_config_id") REFERENCES "public"."tier_config"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_movement_config" ADD CONSTRAINT "balance_movement_config_amount_type_amount_type_code_fk" FOREIGN KEY ("amount_type") REFERENCES "public"."amount_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_amount" ADD CONSTRAINT "payment_order_amount_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_amount" ADD CONSTRAINT "payment_order_amount_amount_type_amount_type_code_fk" FOREIGN KEY ("amount_type") REFERENCES "public"."amount_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_balance_movement" ADD CONSTRAINT "payment_order_balance_movement_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_balance_movement" ADD CONSTRAINT "payment_order_balance_movement_amount_type_amount_type_code_fk" FOREIGN KEY ("amount_type") REFERENCES "public"."amount_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_ledger_tx" ADD CONSTRAINT "payment_order_ledger_tx_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_status_history" ADD CONSTRAINT "payment_order_status_history_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_service_command_id_service_command_id_fk" FOREIGN KEY ("service_command_id") REFERENCES "public"."service_command"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tier_config_id_tier_config_id_fk" FOREIGN KEY ("tier_config_id") REFERENCES "public"."tier_config"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_original_order_id_payment_orders_id_fk" FOREIGN KEY ("original_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "fk_po_service_currency" FOREIGN KEY ("service_id","currency") REFERENCES "public"."service"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_service_group_id_service_group_id_fk" FOREIGN KEY ("service_group_id") REFERENCES "public"."service_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_command" ADD CONSTRAINT "service_command_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_command_spi" ADD CONSTRAINT "service_command_spi_service_command_id_service_command_id_fk" FOREIGN KEY ("service_command_id") REFERENCES "public"."service_command"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_command_spi" ADD CONSTRAINT "service_command_spi_spi_id_spi_id_fk" FOREIGN KEY ("spi_id") REFERENCES "public"."spi"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spi_external_config" ADD CONSTRAINT "fk_spi_external" FOREIGN KEY ("spi_id","spi_type") REFERENCES "public"."spi"("id","spi_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spi_internal_config" ADD CONSTRAINT "fk_spi_internal" FOREIGN KEY ("spi_id","spi_type") REFERENCES "public"."spi"("id","spi_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_amount_rule" ADD CONSTRAINT "tier_amount_rule_tier_config_id_tier_config_id_fk" FOREIGN KEY ("tier_config_id") REFERENCES "public"."tier_config"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_amount_rule" ADD CONSTRAINT "tier_amount_rule_amount_type_amount_type_code_fk" FOREIGN KEY ("amount_type") REFERENCES "public"."amount_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_amount_rule" ADD CONSTRAINT "tier_amount_rule_base_amount_type_amount_type_code_fk" FOREIGN KEY ("base_amount_type") REFERENCES "public"."amount_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_config" ADD CONSTRAINT "tier_config_service_command_id_service_command_id_fk" FOREIGN KEY ("service_command_id") REFERENCES "public"."service_command"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pobm_pending" ON "payment_order_balance_movement" USING btree ("created_at") WHERE "payment_order_balance_movement"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "idx_posh_order" ON "payment_order_status_history" USING btree ("payment_order_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_po_customer_created" ON "payment_orders" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_po_payer_created" ON "payment_orders" USING btree ("payer_account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_po_payee_created" ON "payment_orders" USING btree ("payee_account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_po_in_flight" ON "payment_orders" USING btree ("status","updated_at") WHERE "payment_orders"."status" IN ('PENDING', 'PROCESSING');--> statement-breakpoint
CREATE INDEX "idx_po_external_reference" ON "payment_orders" USING btree ("external_reference");--> statement-breakpoint
CREATE INDEX "idx_po_original_order" ON "payment_orders" USING btree ("original_order_id") WHERE "payment_orders"."original_order_id" IS NOT NULL;