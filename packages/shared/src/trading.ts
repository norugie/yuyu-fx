import { z } from "zod";

// Trading vocabulary shared by server and web. The server validates every
// request with these schemas; the order ticket can reuse them for instant feedback.
//
// Money is a decimal string ("12.34"), never a JS number: binary floats can't
// represent most prices exactly (0.1 + 0.2 !== 0.3), and rounding errors in P&L
// add up. The database stores it as numeric(14, 4).

export const SIDES = ["buy", "sell"] as const;
export const ORDER_SOURCES = ["manual", "rules", "ai"] as const;
export const TRADING_MODES = ["paper", "live"] as const;
export const ORDER_STATUSES = ["open", "filled", "cancelled", "rejected"] as const;
/** What is stored per order row. A bracket request becomes 3 rows (see BRACKET_ROLES). */
export const STORED_ORDER_TYPES = ["market", "limit", "stop"] as const;
export const BRACKET_ROLES = ["entry", "stop_loss", "take_profit"] as const;
export const QUOTE_SOURCES = ["manual", "questrade"] as const;

export type Side = (typeof SIDES)[number];
export type OrderSource = (typeof ORDER_SOURCES)[number];
export type TradingModeValue = (typeof TRADING_MODES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type StoredOrderType = (typeof STORED_ORDER_TYPES)[number];
export type BracketRole = (typeof BRACKET_ROLES)[number];
export type QuoteSource = (typeof QUOTE_SOURCES)[number];

/**
 * TSX ticker: 1-6 letters, optionally a class or unit suffix after a dot
 * (BBD.B, CTC.A, REI.UN). Trimmed and uppercased before checking.
 */
export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,6}(\.[A-Z]{1,2})?$/, { error: "Not a valid TSX symbol (e.g. RY, BBD.B, REI.UN)" });

/** Whole shares only. Size limits are risk rules, not part of the format. */
export const quantitySchema = z
  .number({ error: "Quantity must be a number" })
  .int({ error: "Quantity must be a whole number of shares" })
  .positive({ error: "Quantity must be more than 0" });

/** A price as a decimal string: up to 4 decimals, more than 0, under 1,000,000. */
export const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,4})?$/, { error: "Price must look like 12.34 (up to 4 decimals)" })
  .refine((value) => Number(value) > 0, { error: "Price must be more than 0" });

export const sideSchema = z.enum(SIDES);

const base = { symbol: symbolSchema, side: sideSchema, quantity: quantitySchema };

const marketOrder = z.object({ ...base, type: z.literal("market") });
const limitOrder = z.object({ ...base, type: z.literal("limit"), limitPrice: priceSchema });

/**
 * Bracket: an entry (market or limit) plus a stop-loss and a take-profit that
 * activate once the entry fills; when one of them fills, the other is cancelled.
 */
const bracketOrder = z
  .object({
    ...base,
    type: z.literal("bracket"),
    entry: z.enum(["market", "limit"]),
    limitPrice: priceSchema.optional(),
    stopLossPrice: priceSchema,
    takeProfitPrice: priceSchema,
  })
  .superRefine((order, ctx) => {
    if (order.entry === "limit" && order.limitPrice === undefined) {
      ctx.addIssue({ code: "custom", path: ["limitPrice"], message: "A limit entry needs a limit price" });
    }
    if (order.entry === "market" && order.limitPrice !== undefined) {
      ctx.addIssue({ code: "custom", path: ["limitPrice"], message: "A market entry has no limit price" });
    }
    const stop = Number(order.stopLossPrice);
    const target = Number(order.takeProfitPrice);
    const entry = order.limitPrice === undefined ? undefined : Number(order.limitPrice);
    // Buy: stop below entry, target above. Sell (short): the other way round.
    const [low, high] = order.side === "buy" ? [stop, target] : [target, stop];
    const ordered = entry === undefined ? low < high : low < entry && entry < high;
    if (!ordered) {
      ctx.addIssue({
        code: "custom",
        path: ["stopLossPrice"],
        message:
          order.side === "buy"
            ? "For a buy, stop-loss must be below the entry and take-profit above it"
            : "For a sell, stop-loss must be above the entry and take-profit below it",
      });
    }
  });

/** What the order ticket (or a strategy, or the AI) submits. */
export const newOrderSchema = z.discriminatedUnion("type", [marketOrder, limitOrder, bracketOrder]);
export type NewOrder = z.infer<typeof newOrderSchema>;

/** A typed-in price for a symbol (PRD Q5, decision D1). */
export const setQuoteSchema = z.object({ symbol: symbolSchema, price: priceSchema });
export type SetQuoteRequest = z.infer<typeof setQuoteSchema>;

export interface QuoteView {
  symbol: string;
  price: string;
  source: QuoteSource;
  quotedAt: string;
  /** True when the quote is from an earlier day (Toronto time) than now. */
  stale: boolean;
}

// ---------------------------------------------------------------------------
// API responses (task 3.4 / 3.5). Money fields are decimal strings with 4 decimals.

export interface OrderView {
  id: string;
  symbol: string;
  side: Side;
  type: StoredOrderType;
  bracketRole: BracketRole | null;
  parentId: string | null;
  quantity: number;
  limitPrice: string | null;
  stopPrice: string | null;
  status: OrderStatus;
  statusReason: string | null;
  source: OrderSource;
  mode: TradingModeValue;
  createdAt: string;
  /** Present once the order has filled. */
  fill: { price: string; fee: string; filledAt: string } | null;
}

export interface PlaceOrderResponse {
  /** The order(s) created; a bracket returns entry, stop-loss and take-profit. */
  orders: OrderView[];
}

/** 422 body when a valid order is refused by the risk checks. */
export interface OrderRejectedResponse {
  error: string;
  order: OrderView;
}

export interface PositionView {
  symbol: string;
  /** Shares held (negative would be a short). */
  quantity: number;
  averageCost: string;
  costBasis: string;
  lastPrice: string | null;
  priceStale: boolean;
  marketValue: string;
  unrealizedPnl: string;
  realizedPnl: string;
  fees: string;
}

export interface PortfolioView {
  startingCash: string;
  cash: string;
  equity: string;
  /** Equity now minus equity at the start of today (exchange time). */
  todayPnl: string;
  realizedPnl: string;
  fees: string;
  openPositions: PositionView[];
}
