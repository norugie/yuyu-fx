import { createHash } from "node:crypto";
import type { CostModel } from "../broker/fill-rules.js";
import { fromUnits, type Units } from "../money.js";
import { maCrossover, type MaCrossoverParams } from "../strategies/ma-crossover.js";
import { buyAndHold, runBacktest, type Bar, type BacktestResult } from "./backtest.js";
import { computeMetrics, type Metrics } from "./metrics.js";

// A backtest report you can reproduce (PRD AC6.1, AC6.3, AC6.4, eval E1).
//
// The last 30% of the history is "held out": the strategy's settings were not
// tuned on it, so its results there are a fairer guess of how it does on data it
// hasn't seen. If a strategy only looks good in-sample, it was probably fitted to
// noise ("overfitting").

/** Bump when the engine's behaviour changes, so old and new reports aren't confused. */
export const ENGINE_VERSION = "1";

export interface ReportInput {
  symbol: string;
  benchmark: string;
  params: Required<MaCrossoverParams>;
  bars: readonly Bar[];
  benchmarkBars: readonly Bar[];
  startingCash: Units;
  costs: CostModel;
  holdoutShare?: number;
}

export interface PeriodMetrics {
  strategy: Metrics;
  benchmark: Metrics;
}

export interface BacktestReport {
  engineVersion: string;
  strategy: string;
  symbol: string;
  benchmark: string;
  params: Required<MaCrossoverParams>;
  startingCash: string;
  costs: { slippageBps: number; feePerShare: string; minFee: string; maxFeeBps: number };
  period: { from: string; to: string; holdoutFrom: string; bars: number };
  all: PeriodMetrics;
  inSample: PeriodMetrics;
  holdout: PeriodMetrics;
  trades: { date: string; side: string; quantity: number; price: string; fee: string }[];
  skipped: BacktestResult["skipped"];
  /** SHA-256 of everything that went in (bars, settings, engine version). */
  inputHash: string;
  /** SHA-256 of everything that came out (metrics and trades). Same inputs -> same hash. */
  resultHash: string;
}

const sha256 = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)))
    .digest("hex");

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function buildReport(input: ReportInput): BacktestReport {
  const { bars } = input;
  if (bars.length < input.params.slow + 2) throw new Error(`Need at least ${input.params.slow + 2} bars, got ${bars.length}`);
  const from = bars[0]?.date ?? "";
  const to = bars.at(-1)?.date ?? "";
  // Benchmark over exactly the same dates.
  const benchmarkBars = input.benchmarkBars.filter((b) => b.date >= from && b.date <= to);

  const strategyRun = runBacktest({ bars, strategy: maCrossover(input.params), startingCash: input.startingCash, costs: input.costs });
  const benchmarkRun = runBacktest({ bars: benchmarkBars, strategy: buyAndHold(input.params.cashShare), startingCash: input.startingCash, costs: input.costs });

  const split = Math.floor(bars.length * (1 - (input.holdoutShare ?? 0.3)));
  const holdoutFrom = bars[split]?.date ?? to;
  const window = (a?: string, b?: string): PeriodMetrics => ({
    strategy: computeMetrics(strategyRun.equity, strategyRun.fills, a, b),
    benchmark: computeMetrics(benchmarkRun.equity, benchmarkRun.fills, a, b),
  });

  const costs = {
    slippageBps: input.costs.slippageBps,
    feePerShare: fromUnits(input.costs.feePerShare),
    minFee: fromUnits(input.costs.minFee),
    maxFeeBps: input.costs.maxFeeBps,
  };
  const inputHash = sha256({
    engineVersion: ENGINE_VERSION,
    symbol: input.symbol,
    benchmark: input.benchmark,
    params: input.params,
    startingCash: input.startingCash,
    costs,
    holdoutShare: input.holdoutShare ?? 0.3,
    bars,
    benchmarkBars,
  });

  const body = {
    engineVersion: ENGINE_VERSION,
    strategy: `MA crossover ${input.params.fast}/${input.params.slow}`,
    symbol: input.symbol,
    benchmark: input.benchmark,
    params: input.params,
    startingCash: fromUnits(input.startingCash),
    costs,
    period: { from, to, holdoutFrom, bars: bars.length },
    all: window(),
    inSample: window(undefined, dayBefore(holdoutFrom)),
    holdout: window(holdoutFrom),
    trades: strategyRun.fills.map((f) => ({ date: f.date, side: f.side, quantity: f.quantity, price: fromUnits(f.price), fee: fromUnits(f.fee) })),
    skipped: strategyRun.skipped,
  };
  return { ...body, inputHash, resultHash: sha256({ ...body, inputHash }) };
}
