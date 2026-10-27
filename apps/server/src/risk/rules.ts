import type { NewOrder, OrderSource, RiskSettings, TradingModeValue } from "@yuyufx/shared";
import { commission, marketFillPrice, type CostModel } from "../broker/fill-rules.js";
import { fromUnits, times, toUnits, type Units } from "../money.js";

// The risk rules (PRD F5, ARCHITECTURE §6), as one pure function. Every order,
// from any source, is checked here before the broker sees it (see gateway.ts).
// The first rule that fails wins; its id goes into the log and the order history.
//
// Two ideas worth knowing:
// - Risk per trade: if the stop-loss is hit, you lose (entry - stop) x shares.
//   Keeping that under ~1% of equity means a run of losing trades can't sink
//   the account. It's why every new position needs a stop.
// - Position size: even with a stop, prices can gap past it (bad news overnight),
//   so no single stock may be more than ~10% of the account.

export type RuleId =
  | "paper_only"
  | "automation_halted"
  | "rate_limit"
  | "quantity_cap"
  | "short_selling"
  | "whitelist"
  | "no_price"
  | "stale_price"
  | "limit_distance"
  | "exit_distance"
  | "stop_required"
  | "risk_per_trade"
  | "position_size"
  | "open_positions"
  | "cash";

export interface RuleFailure {
  rule: RuleId;
  reason: string;
}

export interface RiskContext {
  source: OrderSource;
  mode: TradingModeValue;
  settings: RiskSettings;
  /** Active halts (daily loss, drawdown, kill switch, stale data). Block automated orders. */
  halts: string[];
  /** Latest price for the symbol, or null if none. */
  quote: { price: Units; stale: boolean } | null;
  /** Account value now (cash + positions at market). */
  equity: Units;
  /** Cash now, minus cash promised to open buy orders. */
  availableCash: Units;
  /** Shares held now, minus shares promised to open sell orders. */
  sellableQuantity: number;
  /** Market value of the shares held in this symbol now. */
  heldValue: Units;
  /** Symbols with an open position (or a pending entry), excluding this one. */
  otherOpenPositions: number;
  /** Orders this user placed in the last 60 seconds. */
  ordersLastMinute: number;
  costs: CostModel;
}

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-CA")}%`;
const dollarFormat = new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "$16,300.50" (display only). */
const dollars = (u: Units) => `$${dollarFormat.format(Number(fromUnits(u)))}`;
const price = (u: Units) => fromUnits(u).replace(/0{1,2}$/, "");
/** Whole shares that fit in `budget` at `perShare` (0 if none). */
const sharesWithin = (budget: Units, perShare: Units): number => (budget > 0n && perShare > 0n ? Number(budget / perShare) : 0);
const shares = (n: number) => `${n.toLocaleString("en-CA")} share${n === 1 ? "" : "s"}`;

function distanceBps(a: Units, reference: Units): number {
  const diff = a > reference ? a - reference : reference - a;
  return Number((diff * 10_000n) / reference);
}

/** Share of equity, in money units, for a limit given in basis points. */
const shareOf = (equity: Units, bpsLimit: number): Units => (equity * BigInt(bpsLimit)) / 10_000n;

/** Price a buy will likely fill at: its limit, or the quote plus slippage. */
export function expectedEntryPrice(order: NewOrder, quote: Units, costs: CostModel): Units {
  const limit = "limitPrice" in order ? order.limitPrice : undefined;
  return limit ? toUnits(limit) : marketFillPrice(quote, order.side, costs);
}

/** Returns the first rule the order breaks, or null if it may go to the broker. */
export function checkOrder(order: NewOrder, ctx: RiskContext): RuleFailure | null {
  const s = ctx.settings;
  const fail = (rule: RuleId, reason: string): RuleFailure => ({ rule, reason });

  if (ctx.mode !== "paper") return fail("paper_only", "Live trading is not enabled. Only paper orders are accepted.");
  if (ctx.source !== "manual" && ctx.halts.length > 0) {
    return fail("automation_halted", `Automated orders are paused: ${ctx.halts.join("; ")}.`);
  }
  if (ctx.ordersLastMinute >= s.maxOrdersPerMinute) {
    return fail("rate_limit", `Too many orders: at most ${s.maxOrdersPerMinute} per minute.`);
  }
  if (order.quantity > s.maxOrderQuantity) {
    return fail("quantity_cap", `Quantity is above the ${s.maxOrderQuantity.toLocaleString("en-CA")}-share limit per order.`);
  }

  // Sells only reduce a position (no short selling), so they skip the entry rules.
  if (order.type === "bracket" && order.side === "sell") {
    return fail("short_selling", "Short selling isn't allowed, so a bracket must start with a buy.");
  }
  const isEntry = order.side === "buy";
  if (!isEntry && order.quantity > ctx.sellableQuantity) {
    return fail(
      "short_selling",
      ctx.sellableQuantity <= 0
        ? `You don't hold any ${order.symbol} to sell (short selling isn't allowed).`
        : `You can sell at most ${ctx.sellableQuantity} ${order.symbol} (shares already in open sell orders don't count).`,
    );
  }

  if (isEntry && !s.allowedSymbols.includes(order.symbol)) {
    return fail("whitelist", `${order.symbol} isn't on your allowed symbols list (Settings).`);
  }

  if (!ctx.quote) return fail("no_price", `No price for ${order.symbol} yet.`);
  if (ctx.quote.stale) return fail("stale_price", `The price for ${order.symbol} is from an earlier day.`);
  const last = ctx.quote.price;

  if ("limitPrice" in order && order.limitPrice && distanceBps(toUnits(order.limitPrice), last) > s.maxLimitDeviationBps) {
    return fail("limit_distance", `Limit price is more than ${pct(s.maxLimitDeviationBps)} away from the last price (${price(last)}).`);
  }

  if (order.type === "bracket") {
    const stop = toUnits(order.stopLossPrice);
    const target = toUnits(order.takeProfitPrice);
    if (order.entry === "market" && !(stop < last && last < target)) {
      return fail("exit_distance", `For a buy at the market, the stop-loss must be below and the take-profit above the last price (${price(last)}).`);
    }
    for (const [name, p] of [["Stop-loss", stop], ["Take-profit", target]] as const) {
      if (distanceBps(p, last) > s.maxExitDeviationBps) {
        return fail("exit_distance", `${name} is more than ${pct(s.maxExitDeviationBps)} away from the last price (${price(last)}).`);
      }
    }
  }

  if (!isEntry) return null; // a sell of shares you hold: done

  const entry = expectedEntryPrice(order, last, ctx.costs);

  if (s.requireStopLoss && order.type !== "bracket") {
    return fail("stop_required", "New positions need a stop-loss: use a bracket order.");
  }

  if (order.type === "bracket") {
    const riskPerShare = entry - toUnits(order.stopLossPrice);
    const risk = times(riskPerShare > 0n ? riskPerShare : 0n, order.quantity);
    const allowed = shareOf(ctx.equity, s.riskPerTradeBps);
    if (risk > allowed) {
      const fit = sharesWithin(allowed, riskPerShare);
      return fail(
        "risk_per_trade",
        `If the stop is hit you'd lose about ${dollars(risk)}. Max risk per trade is ${dollars(allowed)} ` +
          `(${pct(s.riskPerTradeBps)} of ${dollars(ctx.equity)} equity). ` +
          (fit > 0 ? `With this stop you can buy up to ${shares(fit)}, or move the stop closer.` : "Move the stop closer."),
      );
    }
  }

  const positionValue = ctx.heldValue + times(entry, order.quantity);
  const maxPosition = shareOf(ctx.equity, s.maxPositionBps);
  if (positionValue > maxPosition) {
    const fit = sharesWithin(maxPosition - ctx.heldValue, entry);
    return fail(
      "position_size",
      `${order.symbol} would be ${dollars(positionValue)} in total. Max per stock is ${dollars(maxPosition)} ` +
        `(${pct(s.maxPositionBps)} of ${dollars(ctx.equity)} equity). ` +
        (fit > 0 ? `You can buy up to ${fit.toLocaleString("en-CA")} more share${fit === 1 ? "" : "s"}.` : `You can't add to ${order.symbol} right now.`),
    );
  }

  if (ctx.heldValue === 0n && ctx.otherOpenPositions >= s.maxOpenPositions) {
    return fail("open_positions", `You already have ${ctx.otherOpenPositions} open positions (limit ${s.maxOpenPositions}).`);
  }

  const cost = times(entry, order.quantity) + commission(entry, order.quantity, ctx.costs);
  if (cost > ctx.availableCash) {
    return fail("cash", `Not enough paper cash: this needs about ${dollars(cost)}; available ${dollars(ctx.availableCash)}.`);
  }

  return null;
}

export const DEFAULT_RISK_SETTINGS: Omit<RiskSettings, "allowedSymbols"> = {
  riskPerTradeBps: 100,
  maxPositionBps: 1000,
  maxOpenPositions: 10,
  dailyLossBps: 300,
  maxDrawdownBps: 1500,
  requireStopLoss: true,
  maxOrderQuantity: 10_000,
  maxLimitDeviationBps: 1000,
  maxExitDeviationBps: 3000,
  maxOrdersPerMinute: 10,
};
