ALTER TYPE "public"."quote_source" ADD VALUE 'questrade';--> statement-breakpoint
CREATE TABLE "broker_credentials" (
	"provider" text PRIMARY KEY NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"bootstrap_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_bars" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric(14, 4) NOT NULL,
	"high" numeric(14, 4) NOT NULL,
	"low" numeric(14, 4) NOT NULL,
	"close" numeric(14, 4) NOT NULL,
	"volume" bigint NOT NULL,
	"source" "quote_source" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_bars_symbol_date_pk" PRIMARY KEY("symbol","date"),
	CONSTRAINT "daily_bars_positive" CHECK ("daily_bars"."low" > 0),
	CONSTRAINT "daily_bars_ohlc_order" CHECK ("daily_bars"."low" <= "daily_bars"."open" and "daily_bars"."low" <= "daily_bars"."close" and "daily_bars"."high" >= "daily_bars"."open" and "daily_bars"."high" >= "daily_bars"."close"),
	CONSTRAINT "daily_bars_volume_not_negative" CHECK ("daily_bars"."volume" >= 0)
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"symbol" text PRIMARY KEY NOT NULL,
	"exchange" text DEFAULT 'TSX' NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"description" text,
	"questrade_symbol_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_questrade_symbol_id_unique" UNIQUE("questrade_symbol_id")
);
