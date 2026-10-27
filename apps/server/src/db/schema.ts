import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  BRACKET_ROLES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  QUOTE_SOURCES,
  SIDES,
  STORED_ORDER_TYPES,
  TRADING_MODES,
} from "@yuyufx/shared";

// Database schema. Migrations are generated from this file into /drizzle
// with `npm run db:generate` and applied with `npm run db:migrate`.

/** The people who can log in. YuyuFX has one user (Youmu) but keeps ids for later. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stored lowercase (see normalizeUsername).
  username: text("username").notNull().unique(),
  // Argon2id hash. Never the plain password.
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Logged-in sessions. The browser holds a random token in a cookie; we store only
 * an HMAC of it, so a copy of this table can't be used to log in.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Synchronizer CSRF token: the browser must echo it in the X-CSRF-Token header.
    csrfToken: text("csrf_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    // Idle timeout: pushed forward on activity.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

// ---------------------------------------------------------------------------
// Trading (Phase 3). Money columns are numeric(14, 4): exact decimals, read and
// written as strings (see packages/shared/src/trading.ts for why not floats).

const money = (name: string) => numeric(name, { precision: 14, scale: 4 });

export const sideEnum = pgEnum("order_side", SIDES);
export const orderSourceEnum = pgEnum("order_source", ORDER_SOURCES);
export const tradingModeEnum = pgEnum("trading_mode", TRADING_MODES);
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);
export const orderTypeEnum = pgEnum("order_type", STORED_ORDER_TYPES);
export const bracketRoleEnum = pgEnum("bracket_role", BRACKET_ROLES);
export const quoteSourceEnum = pgEnum("quote_source", QUOTE_SOURCES);

/**
 * Every order, whoever placed it. A bracket is three rows: the entry, plus a
 * stop-loss and a take-profit whose parent_id points at the entry.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    source: orderSourceEnum("source").notNull(),
    mode: tradingModeEnum("mode").notNull(),
    symbol: text("symbol").notNull(),
    side: sideEnum("side").notNull(),
    type: orderTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),
    limitPrice: money("limit_price"),
    stopPrice: money("stop_price"),
    parentId: uuid("parent_id").references((): AnyPgColumn => orders.id),
    bracketRole: bracketRoleEnum("bracket_role"),
    status: orderStatusEnum("status").notNull(),
    // Why an order was rejected or cancelled (risk rule, user, OCO sibling filled).
    statusReason: text("status_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("orders_user_created_idx").on(table.userId, table.createdAt),
    index("orders_parent_idx").on(table.parentId),
    check("orders_quantity_positive", sql`${table.quantity} > 0`),
    check("orders_limit_needs_price", sql`${table.type} <> 'limit' or ${table.limitPrice} is not null`),
    check("orders_stop_needs_price", sql`${table.type} <> 'stop' or ${table.stopPrice} is not null`),
  ],
);

/** Executions. Simulated in paper mode; entered or synced in live mode (F8). */
export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    symbol: text("symbol").notNull(),
    side: sideEnum("side").notNull(),
    quantity: integer("quantity").notNull(),
    price: money("price").notNull(),
    fee: money("fee").notNull().default("0"),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("fills_user_symbol_idx").on(table.userId, table.symbol),
    index("fills_order_idx").on(table.orderId),
    check("fills_quantity_positive", sql`${table.quantity} > 0`),
    check("fills_price_positive", sql`${table.price} > 0`),
    check("fills_fee_not_negative", sql`${table.fee} >= 0`),
  ],
);

/** Prices. Typed in by Youmu until a market-data source exists (PRD Q5, D1). */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    price: money("price").notNull(),
    source: quoteSourceEnum("source").notNull(),
    quotedAt: timestamp("quoted_at", { withTimezone: true }).notNull(),
    // Who typed it in (null for automatic sources later).
    enteredBy: uuid("entered_by").references(() => users.id),
  },
  (table) => [
    index("quotes_symbol_time_idx").on(table.symbol, table.quotedAt),
    check("quotes_price_positive", sql`${table.price} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Market data (Phase 4, PRD F10).

/** Symbols we track, with the data provider's id for each. */
export const instruments = pgTable("instruments", {
  symbol: text("symbol").primaryKey(),
  exchange: text("exchange").notNull().default("TSX"),
  currency: text("currency").notNull().default("CAD"),
  description: text("description"),
  questradeSymbolId: integer("questrade_symbol_id").unique(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * One row per symbol per trading day (the exchange's calendar date).
 * Prices as delivered by the source (not split/dividend-adjusted unless the source says so).
 */
export const dailyBars = pgTable(
  "daily_bars",
  {
    symbol: text("symbol").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    open: money("open").notNull(),
    high: money("high").notNull(),
    low: money("low").notNull(),
    close: money("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
    source: quoteSourceEnum("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.symbol, table.date] }),
    check("daily_bars_positive", sql`${table.low} > 0`),
    check(
      "daily_bars_ohlc_order",
      sql`${table.low} <= ${table.open} and ${table.low} <= ${table.close} and ${table.high} >= ${table.open} and ${table.high} >= ${table.close}`,
    ),
    check("daily_bars_volume_not_negative", sql`${table.volume} >= 0`),
  ],
);

/**
 * API credentials, encrypted at rest (AES-256-GCM, see src/secrets.ts).
 * `bootstrapHash` remembers which .env token was already used, so a used one
 * isn't tried again, but a newly pasted one is.
 */
export const brokerCredentials = pgTable("broker_credentials", {
  provider: text("provider").primaryKey(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  bootstrapHash: text("bootstrap_hash"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------
// Risk engine (Phase 5, PRD F5). Percentages are stored in basis points
// (1 bp = 0.01%, so 100 bp = 1%) to keep them whole numbers.

/** Risk limits per user. Defaults are ARCHITECTURE §6's starting values. */
export const riskSettings = pgTable("risk_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  riskPerTradeBps: integer("risk_per_trade_bps").notNull().default(100),
  maxPositionBps: integer("max_position_bps").notNull().default(1000),
  maxOpenPositions: integer("max_open_positions").notNull().default(10),
  dailyLossBps: integer("daily_loss_bps").notNull().default(300),
  maxDrawdownBps: integer("max_drawdown_bps").notNull().default(1500),
  requireStopLoss: boolean("require_stop_loss").notNull().default(true),
  maxOrderQuantity: integer("max_order_quantity").notNull().default(10_000),
  maxLimitDeviationBps: integer("max_limit_deviation_bps").notNull().default(1000),
  maxExitDeviationBps: integer("max_exit_deviation_bps").notNull().default(3000),
  maxOrdersPerMinute: integer("max_orders_per_minute").notNull().default(10),
  allowedSymbols: text("allowed_symbols").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Halts and the equity high-water mark that the drawdown limit is measured from. */
export const tradingState = pgTable("trading_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Highest equity seen (for the drawdown limit). */
  peakEquity: money("peak_equity"),
  /** Automation halted for this exchange date (daily loss limit). */
  dailyHaltDate: date("daily_halt_date", { mode: "string" }),
  /** Set when the drawdown limit was hit; cleared only when Youmu re-enables. */
  drawdownHaltedAt: timestamp("drawdown_halted_at", { withTimezone: true }),
  /** Set by the kill switch; cleared only when Youmu re-enables. */
  killSwitchAt: timestamp("kill_switch_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Fill = typeof fills.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type DailyBar = typeof dailyBars.$inferSelect;
export type RiskSettingsRow = typeof riskSettings.$inferSelect;
export type TradingStateRow = typeof tradingState.$inferSelect;
