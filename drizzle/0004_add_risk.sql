CREATE TABLE "risk_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"risk_per_trade_bps" integer DEFAULT 100 NOT NULL,
	"max_position_bps" integer DEFAULT 1000 NOT NULL,
	"max_open_positions" integer DEFAULT 10 NOT NULL,
	"daily_loss_bps" integer DEFAULT 300 NOT NULL,
	"max_drawdown_bps" integer DEFAULT 1500 NOT NULL,
	"require_stop_loss" boolean DEFAULT true NOT NULL,
	"max_order_quantity" integer DEFAULT 10000 NOT NULL,
	"max_limit_deviation_bps" integer DEFAULT 1000 NOT NULL,
	"max_exit_deviation_bps" integer DEFAULT 3000 NOT NULL,
	"max_orders_per_minute" integer DEFAULT 10 NOT NULL,
	"allowed_symbols" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"peak_equity" numeric(14, 4),
	"daily_halt_date" date,
	"drawdown_halted_at" timestamp with time zone,
	"kill_switch_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risk_settings" ADD CONSTRAINT "risk_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_state" ADD CONSTRAINT "trading_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;