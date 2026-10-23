CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"asset" text NOT NULL,
	"ledger_address" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_ledger_address_unique" UNIQUE("ledger_address"),
	CONSTRAINT "accounts_customer_currency_unique" UNIQUE("customer_id","currency"),
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" in ('USD', 'KHR')),
	CONSTRAINT "accounts_status_check" CHECK ("accounts"."status" in ('active', 'frozen', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"kyc_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "customers_kyc_status_check" CHECK ("customers"."kyc_status" in ('pending', 'verified', 'rejected')),
	CONSTRAINT "customers_status_check" CHECK ("customers"."status" in ('active', 'suspended', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_customer_id_idx" ON "accounts" USING btree ("customer_id");