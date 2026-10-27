import type { Strategy } from "../engine/backtest.js";
import { divRound, type Units } from "../money.js";

// Moving-average crossover (task 4.8): a classic trend-following rule, chosen
// because it's easy to read and test, not because it's expected to beat the market.
//
// A simple moving average (SMA) of N days is the average closing price of the last
// N days. The fast one (e.g. 20 days) follows recent prices closely; the slow one
// (e.g. 50 days) is smoother. When the fast average crosses ABOVE the slow one,
// prices have recently been rising faster than usual: buy. When it crosses back
// BELOW: sell. Long or flat only (no short selling).

/** Average of the last `period` values, or null if there aren't enough. */
export function sma(values: readonly Units[], period: number): Units | null {
  if (values.length < period) return null;
  let sum = 0n;
  for (let i = values.length - period; i < values.length; i++) sum += values[i] ?? 0n;
  return divRound(sum, BigInt(period), "down");
}

export interface MaCrossoverParams {
  fast: number;
  slow: number;
  /** Share of cash to invest on a buy signal (the rest covers slippage, fees, gaps). */
  cashShare?: number;
}

export function maCrossover({ fast, slow, cashShare = 0.98 }: MaCrossoverParams): Strategy {
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 1 || fast >= slow) {
    throw new Error("Moving averages need whole numbers with fast < slow (e.g. 20 and 50)");
  }
  return ({ bars, position, cash }) => {
    const closes = bars.map((b) => b.close);
    const today = bars.at(-1);
    if (!today || closes.length < slow + 1) return [];

    const fastNow = sma(closes, fast);
    const slowNow = sma(closes, slow);
    const fastPrev = sma(closes.slice(0, -1), fast);
    const slowPrev = sma(closes.slice(0, -1), slow);
    if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null) return [];

    const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
    const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;

    if (position === 0 && crossedUp) {
      // Size from today's close; the order fills at tomorrow's open.
      const quantity = Math.floor((Number(cash) * cashShare) / Number(today.close));
      return quantity > 0 ? [{ side: "buy", quantity }] : [];
    }
    if (position > 0 && crossedDown) return [{ side: "sell", quantity: position }];
    return [];
  };
}
