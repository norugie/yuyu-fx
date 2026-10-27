import { describe, expect, it } from "vitest";
import { DEFAULT_COSTS } from "../src/broker/fill-rules.js";
import { buyAndHold, runBacktest, type Bar, type Strategy } from "../src/engine/backtest.js";
import { computeMetrics, maxDrawdown, roundTrips, sharpeRatio } from "../src/engine/metrics.js";
import { fromUnits, toUnits } from "../src/money.js";

// Tasks 4.6 and 4.7: the event loop and the metrics.

const bar = (date: string, open: string, close: string): Bar => ({
  date,
  open: toUnits(open),
  high: toUnits(String(Math.max(Number(open), Number(close)))),
  low: toUnits(String(Math.min(Number(open), Number(close)))),
  close: toUnits(close),
  volume: 1000,
});

const bars = [
  bar("2026-01-05", "10", "10"),
  bar("2026-01-06", "11", "12"),
  bar("2026-01-07", "13", "14"),
  bar("2026-01-08", "15", "15"),
];
const noCosts = { ...DEFAULT_COSTS, slippageBps: 0, feePerShare: 0n, minFee: 0n };

describe("runBacktest (AC6.2: no look-ahead)", () => {
  it("only ever shows the strategy bars up to 'today'", () => {
    const seen: string[] = [];
    const spy: Strategy = ({ bars: visible }) => {
      seen.push(`${visible.length}:${visible.at(-1)?.date}`);
      return [];
    };
    runBacktest({ bars, strategy: spy, startingCash: toUnits("1000"), costs: noCosts });
    // Decides after days 1-3 (not after the last day: there's no tomorrow to trade).
    expect(seen).toEqual(["1:2026-01-05", "2:2026-01-06", "3:2026-01-07"]);
  });

  it("gives the strategy a read-only history", () => {
    const tamper: Strategy = ({ bars: visible }) => {
      (visible as Bar[]).push(bar("2099-01-01", "1", "1"));
      return [];
    };
    expect(() => runBacktest({ bars, strategy: tamper, startingCash: toUnits("1000"), costs: noCosts })).toThrow();
  });

  it("fills a decision made on day 1's close at day 2's OPEN, not day 1's close", () => {
    const buyOnce: Strategy = ({ bars: visible, position }) => (visible.length === 1 && position === 0 ? [{ side: "buy", quantity: 10 }] : []);
    const result = runBacktest({ bars, strategy: buyOnce, startingCash: toUnits("1000"), costs: noCosts });
    expect(result.fills.map((f) => [f.date, fromUnits(f.price)])).toEqual([["2026-01-06", "11.0000"]]);
    // Equity at day 2's close: 1000 - 110 + 10 x 12 = 1010
    expect(fromUnits(result.equity[1]?.equity ?? 0n)).toBe("1010.0000");
  });

  it("charges slippage and fees like paper trading", () => {
    const buyOnce: Strategy = ({ bars: visible }) => (visible.length === 1 ? [{ side: "buy", quantity: 10 }] : []);
    const result = runBacktest({ bars, strategy: buyOnce, startingCash: toUnits("1000"), costs: DEFAULT_COSTS });
    // 11 + 5 bp = 11.0055 -> 11.01 (next cent up); fee: 10 x 0.01 = 0.10, min 1.00, but capped at 0.5% of 110.10 = 0.5505
    expect(result.fills[0]).toMatchObject({ price: toUnits("11.01"), fee: toUnits("0.5505") });
  });

  it("skips orders it can't afford, and sells of shares it doesn't hold", () => {
    const greedy: Strategy = ({ bars: visible }) =>
      visible.length === 1 ? [{ side: "buy", quantity: 1_000 }] : visible.length === 2 ? [{ side: "sell", quantity: 5 }] : [];
    const result = runBacktest({ bars, strategy: greedy, startingCash: toUnits("1000"), costs: noCosts });
    expect(result.fills).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(["not enough cash at the open", "selling more than held (no short selling)"]);
  });

  it("refuses unordered or duplicate dates", () => {
    expect(() => runBacktest({ bars: [bars[1] as Bar, bars[0] as Bar], strategy: () => [], startingCash: 0n, costs: noCosts })).toThrow(/date order/);
  });

  it("buy-and-hold buys on day 2's open and holds", () => {
    const result = runBacktest({ bars, strategy: buyAndHold(0.9), startingCash: toUnits("1000"), costs: noCosts });
    expect(result.fills.map((f) => [f.date, f.quantity])).toEqual([["2026-01-06", 90]]);
  });

  it("buy-and-hold retries when a gap up makes the first buy unaffordable", () => {
    // Sized at day 1's close (10) with all the cash, but day 2 opens at 11: skipped, then retried.
    // Day 1: sized at 10 -> 100 shares; day 2 opens at 11 (1,100 > 1,000): skipped.
    // Day 2 closes at 10.50 -> 95 shares; day 3 opens at 10.50 -> 997.50: filled.
    const gap = [bar("2026-01-05", "10", "10"), bar("2026-01-06", "11", "10.50"), bar("2026-01-07", "10.50", "10.50")];
    const result = runBacktest({ bars: gap, strategy: buyAndHold(1), startingCash: toUnits("1000"), costs: noCosts });
    expect(result.skipped).toHaveLength(1);
    expect(result.fills.map((f) => [f.date, f.quantity])).toEqual([["2026-01-07", 95]]);
  });
});

describe("metrics (AC6.3)", () => {
  it("max drawdown: 100 -> 120 -> 90 -> 130 is -25%", () => {
    expect(maxDrawdown([100, 120, 90, 130])).toBeCloseTo(-0.25, 10);
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });

  it("Sharpe: hand-computed for returns of +1%, -1%, +2%", () => {
    // Equity 100 -> 101 -> 99.99 -> 101.9898: returns 0.01, -0.01, 0.02
    const values = [100, 101, 99.99, 101.9898];
    const r = [0.01, -0.01, 0.02];
    const mean = r.reduce((a, b) => a + b) / 3;
    const sd = Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / 2);
    expect(sharpeRatio(values)).toBeCloseTo((mean / sd) * Math.sqrt(252), 6);
    expect(sharpeRatio([100, 100, 100])).toBeNull(); // no volatility
  });

  it("round trips: buy 10 @ 10, sell 10 @ 12 (fee 1 each) -> +18", () => {
    const trips = roundTrips([
      { date: "d1", side: "buy", quantity: 10, price: toUnits("10"), fee: toUnits("1") },
      { date: "d2", side: "sell", quantity: 10, price: toUnits("12"), fee: toUnits("1") },
      { date: "d3", side: "buy", quantity: 5, price: toUnits("12"), fee: toUnits("1") },
    ]);
    expect(trips).toEqual([{ closedOn: "d2", pnl: 18 }]); // the open trade isn't counted
  });

  it("summarises a window of the equity curve", () => {
    const result = runBacktest({ bars, strategy: buyAndHold(0.9), startingCash: toUnits("1000"), costs: noCosts });
    const all = computeMetrics(result.equity, result.fills);
    // 90 shares bought at 11 (cash left 10); final close 15 -> 10 + 1350 = 1360.
    expect(all).toMatchObject({ from: "2026-01-05", to: "2026-01-08", days: 4, endEquity: 1360, roundTrips: 0, winRate: null });
    expect(all.totalReturn).toBeCloseTo(0.36, 10);
    const late = computeMetrics(result.equity, result.fills, "2026-01-07");
    expect(late.startEquity).toBe(10 + 90 * 14);
    expect(late.totalReturn).toBeCloseTo(1360 / 1270 - 1, 10);
  });
});
