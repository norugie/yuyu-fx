CREATE TYPE "public"."bracket_role" AS ENUM('entry', 'stop_loss', 'take_profit');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('manual', 'rules', 'ai');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'filled', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit', 'stop');--> statement-breakpoint
CREATE TYPE "public"."quote_source" AS ENUM('manual');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trading_mode" AS ENUM('paper', 'live');--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" "order_side" NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(14, 4) NOT NULL,
	"fee" numeric(14, 4) DEFAULT '0' NOT NULL,
	"filled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fills_quantity_positive" CHECK ("fills"."quantity" > 0),
	CONSTRAINT "fills_price_positive" CHECK ("fills"."price" > 0),
	CONSTRAINT "fills_fee_not_negative" CHECK ("fills"."fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "order_source" NOT NULL,
	"mode" "trading_mode" NOT NULL,
	"symbol" text NOT NULL,
	"side" "order_side" NOT NULL,
	"type" "order_type" NOT NULL,
	"quantity" integer NOT NULL,
	"limit_price" numeric(14, 4),
	"stop_price" numeric(14, 4),
	"parent_id" uuid,
	"bracket_role" "bracket_role",
	"status" "order_status" NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_quantity_positive" CHECK ("orders"."quantity" > 0),
	CONSTRAINT "orders_limit_needs_price" CHECK ("orders"."type" <> 'limit' or "orders"."limit_price" is not null),
	CONSTRAINT "orders_stop_needs_price" CHECK ("orders"."type" <> 'stop' or "orders"."stop_price" is not null)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"price" numeric(14, 4) NOT NULL,
	"source" "quote_source" NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"entered_by" uuid,
	CONSTRAINT "quotes_price_positive" CHECK ("quotes"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_parent_id_orders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fills_user_symbol_idx" ON "fills" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "fills_order_idx" ON "fills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_parent_idx" ON "orders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "quotes_symbol_time_idx" ON "quotes" USING btree ("symbol","quoted_at");