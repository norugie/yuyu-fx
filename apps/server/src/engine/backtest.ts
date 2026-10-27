import type { Side } from "@yuyufx/shared";
import { commission, marketFillPrice, type CostModel } from "../broker/fill-rules.js";
import { times, type Units } from "../money.js";

// The backtester's event loop (task 4.6, PRD AC6.1-6.2).
//
// For each trading day, in order:
//   1. orders decided yesterday fill at today's OPEN (plus slippage and fees),
//   2. the account is valued at today's CLOSE,
//   3. the strategy looks at bars up to and including today and decides
//      what to do tomorrow.
// The strategy never sees a bar after "today". Seeing the future ("look-ahead
// bias") is the most common way backtests lie: deciding on today's close and
// also filling at today's close assumes you could trade at a price you only
// knew after the market closed.

export interface Bar {
  date: string;
  open: Units;
  high: Units;
  low: Units;
  close: Units;
  volume: number;
}

export interface StrategyContext {
  /** Bars up to and including today. Read-only. */
  bars: readonly Bar[];
  /** Shares held now. */
  position: number;
  cash: Units;
}

/** A market order to execute at the next day's open. */
export interface Signal {
  side: Side;
  quantity: number;
}

/** Strategies are plain functions: bars in, proposed orders out (ARCHITECTURE §4). */
export type Strategy = (context: StrategyContext) => Signal[];

export interface BacktestFill {
  date: string;
  side: Side;
  quantity: number;
  price: Units;
  fee: Units;
}

export interface EquityPoint {
  date: string;
  equity: Units;
  cash: Units;
  position: number;
}

export interface BacktestResult {
  fills: BacktestFill[];
  equity: EquityPoint[];
  /** Orders that couldn't be executed (not enough cash, nothing to sell). */
  skipped: { date: string; side: Side; quantity: number; reason: string }[];
}

export interface BacktestInput {
  bars: readonly Bar[];
  strategy: Strategy;
  startingCash: Units;
  costs: CostModel;
}

export function runBacktest({ bars, strategy, startingCash, costs }: BacktestInput): BacktestResult {
  for (let i = 1; i < bars.length; i++) {
    if ((bars[i]?.date ?? "") <= (bars[i - 1]?.date ?? "")) throw new Error("Bars must be in date order, one per day");
  }

  let cash = startingCash;
  let position = 0;
  let pending: Signal[] = [];
  const fills: BacktestFill[] = [];
  const equity: EquityPoint[] = [];
  const skipped: BacktestResult["skipped"] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (!bar) continue;

    // 1. Yesterday's decisions fill at today's open.
    for (const signal of pending) {
      if (!Number.isInteger(signal.quantity) || signal.quantity <= 0) continue;
      const price = marketFillPrice(bar.open, signal.side, costs);
      const fee = commission(price, signal.quantity, costs);
      const notional = times(price, signal.quantity);
      if (signal.side === "buy" && notional + fee > cash) {
        skipped.push({ date: bar.date, ...signal, reason: "not enough cash at the open" });
        continue;
      }
      if (signal.side === "sell" && signal.quantity > position) {
        skipped.push({ date: bar.date, ...signal, reason: "selling more than held (no short selling)" });
        continue;
      }
      cash += signal.side === "buy" ? -notional - fee : notional - fee;
      position += signal.side === "buy" ? signal.quantity : -signal.quantity;
      fills.push({ date: bar.date, side: signal.side, quantity: signal.quantity, price, fee });
    }
    pending = [];

    // 2. Value the account at the close.
    equity.push({ date: bar.date, equity: cash + times(bar.close, position), cash, position });

    // 3. Decide for tomorrow, seeing only bars up to today.
    if (i < bars.length - 1) {
      pending = strategy({ bars: Object.freeze(bars.slice(0, i + 1)), position, cash });
    }
  }

  return { fills, equity, skipped };
}

/**
 * The benchmark: buy as many shares as the cash allows, then hold. If the buy
 * can't be filled (the next open gapped up past the cash), it simply tries again.
 */
export const buyAndHold =
  (cashShare = 0.98): Strategy =>
  ({ bars, position, cash }) => {
    const today = bars.at(-1);
    if (position > 0 || !today) return [];
    const quantity = Math.floor((Number(cash) * cashShare) / Number(today.close));
    return quantity > 0 ? [{ side: "buy", quantity }] : [];
  };
