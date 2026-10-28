CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'FROZEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('CURRENT', 'AGENT_FLOAT', 'COMMISSION', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('PENDING_KYC', 'ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."profile_type" AS ENUM('INDIVIDUAL', 'AGENT', 'INTERNAL');--> statement-breakpoint
CREATE SEQUENCE "public"."profile_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."stock_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "account_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_type" "profile_type" NOT NULL,
	"product_type" "product_type" NOT NULL,
	"name" varchar(140),
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_account_owner" CHECK (("account_product"."product_type" = 'CURRENT' AND "account_product"."profile_type" = 'INDIVIDUAL')
       OR ("account_product"."product_type" IN ('AGENT_FLOAT', 'COMMISSION') AND "account_product"."profile_type" = 'AGENT')
       OR ("account_product"."product_type" = 'INTERNAL' AND "account_product"."profile_type" = 'INTERNAL'))
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_number" varchar(20) DEFAULT ('CIF' || lpad(nextval('profile_number_seq')::text, 9, '0')) NOT NULL,
	"profile_type" "profile_type" NOT NULL,
	"full_name" varchar(140) NOT NULL,
	"phone_number" varchar(20),
	"kyc_verified" boolean DEFAULT false NOT NULL,
	"status" "profile_status" DEFAULT 'PENDING_KYC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_profile_number_unique" UNIQUE("profile_number"),
	CONSTRAINT "profile_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "uq_profile_type" UNIQUE("id","profile_type"),
	CONSTRAINT "chk_active_needs_kyc" CHECK ("profile"."status" <> 'ACTIVE' OR "profile"."profile_type" = 'INTERNAL' OR "profile"."kyc_verified")
);
--> statement-breakpoint
CREATE TABLE "stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_product_id" uuid NOT NULL,
	"stock_number" varchar(34) DEFAULT lpad(nextval('stock_number_seq')::text, 12, '0') NOT NULL,
	"currency" char(3) NOT NULL,
	"ledger_account" varchar(200) NOT NULL,
	"ledger_balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"hold_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"available_balance" numeric(20, 2) GENERATED ALWAYS AS (ledger_balance - hold_amount) STORED,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_stock_number_unique" UNIQUE("stock_number"),
	CONSTRAINT "stock_ledger_account_unique" UNIQUE("ledger_account"),
	CONSTRAINT "uq_stock_currency" UNIQUE("account_product_id","currency"),
	CONSTRAINT "chk_stock_hold" CHECK ("stock"."hold_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_product" ADD CONSTRAINT "fk_account_owner" FOREIGN KEY ("profile_id","profile_type") REFERENCES "public"."profile"("id","profile_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_account_product_id_account_product_id_fk" FOREIGN KEY ("account_product_id") REFERENCES "public"."account_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_product_profile" ON "account_product" USING btree ("profile_id");