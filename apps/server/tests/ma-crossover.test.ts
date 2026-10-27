import { describe, expect, it } from "vitest";
import { DEFAULT_COSTS } from "../src/broker/fill-rules.js";
import type { Bar } from "../src/engine/backtest.js";
import { buildReport } from "../src/engine/report.js";
import { fromUnits, toUnits } from "../src/money.js";
import { maCrossover, sma } from "../src/strategies/ma-crossover.js";
import { syntheticBars } from "./helpers/fake-questrade.js";

// Task 4.8: the moving-average strategy and a reproducible report (AC6.4).

const closesToBars = (closes: number[]): Bar[] =>
  closes.map((c, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    const p = toUnits(c.toFixed(2));
    return { date: d.toISOString().slice(0, 10), open: p, high: p, low: p, close: p, volume: 100 };
  });

describe("sma", () => {
  it("averages the last N values", () => {
    expect(fromUnits(sma([1, 2, 3, 4].map((n) => toUnits(String(n))), 2) ?? 0n)).toBe("3.5000");
    expect(sma([toUnits("1")], 2)).toBeNull();
  });
});

describe("maCrossover(2, 4)", () => {
  const strategy = maCrossover({ fast: 2, slow: 4 });
  const ctx = (closes: number[], position = 0) => ({ bars: closesToBars(closes), position, cash: toUnits("1000") });

  it("buys when the fast average crosses above the slow one", () => {
    // Falling then a jump: fast(2) goes from below slow(4) to above it on the last bar.
    expect(strategy(ctx([10, 9, 8, 7, 12]))).toEqual([{ side: "buy", quantity: Math.floor((1000 * 0.98) / 12) }]);
  });

  it("does nothing without a cross, or with too little history", () => {
    expect(strategy(ctx([10, 11, 12, 13, 14]))).toEqual([]); // already above, no new cross
    expect(strategy(ctx([10, 9, 8, 7]))).toEqual([]); // needs slow + 1 bars
  });

  it("sells everything when the fast average crosses back below", () => {
    expect(strategy(ctx([10, 11, 12, 13, 5], 50))).toEqual([{ side: "sell", quantity: 50 }]);
  });

  it("ignores a buy signal while already holding (long or flat only)", () => {
    expect(strategy(ctx([10, 9, 8, 7, 12], 50))).toEqual([]);
  });

  it("rejects silly settings", () => {
    expect(() => maCrossover({ fast: 50, slow: 20 })).toThrow(/fast < slow/);
  });
});

describe("buildReport", () => {
  const toBars = (seed: number) =>
    syntheticBars("2018-01-01", 1500, 30, seed).map((b) => ({
      date: b.date,
      open: toUnits(b.open.toFixed(2)),
      high: toUnits(b.high.toFixed(2)),
      low: toUnits(b.low.toFixed(2)),
      close: toUnits(b.close.toFixed(2)),
      volume: b.volume,
    }));
  const input = {
    symbol: "RY",
    benchmark: "XIU",
    params: { fast: 20, slow: 50, cashShare: 0.98 },
    bars: toBars(7),
    benchmarkBars: toBars(3),
    startingCash: toUnits("100000"),
    costs: DEFAULT_COSTS,
  };

  it("is identical when run twice on the same inputs (AC6.4)", () => {
    const a = buildReport(input);
    const b = buildReport(input);
    expect(a.resultHash).toBe(b.resultHash);
    expect(a).toEqual(b);
  });

  it("changes its hashes when anything that matters changes", () => {
    const a = buildReport(input);
    const other = buildReport({ ...input, params: { ...input.params, fast: 10 } });
    expect(other.inputHash).not.toBe(a.inputHash);
    expect(other.resultHash).not.toBe(a.resultHash);
  });

  it("splits 70/30 and reports strategy next to the benchmark for each period", () => {
    const r = buildReport(input);
    expect(r.period.bars).toBe(1500);
    expect(r.period.holdoutFrom).toBe(input.bars[1050]?.date);
    expect(r.inSample.strategy.to < r.period.holdoutFrom).toBe(true);
    expect(r.holdout.strategy.from).toBe(r.period.holdoutFrom);
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.all.benchmark.roundTrips).toBe(0); // buy and hold never sells
  });
});
