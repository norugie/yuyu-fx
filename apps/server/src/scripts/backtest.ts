// `npm run backtest -- --symbol XIU --fast 20 --slow 50 [--benchmark XIU] [--from YYYY-MM-DD] [--to YYYY-MM-DD]`
// Runs the moving-average strategy on stored daily bars, prints the report and
// saves it as JSON under evals/backtests/ (file name includes the result hash).

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DEFAULT_COSTS } from "../broker/fill-rules.js";
import { ConfigError, loadConfig, loadEnvFileIfPresent } from "../config.js";
import { createDatabase, type Database } from "../db/client.js";
import { dailyBars } from "../db/schema.js";
import type { Bar } from "../engine/backtest.js";
import type { Metrics } from "../engine/metrics.js";
import { buildReport } from "../engine/report.js";
import { toUnits } from "../money.js";

async function loadBars(db: Database, symbol: string, from?: string, to?: string): Promise<Bar[]> {
  const rows = await db
    .select()
    .from(dailyBars)
    .where(and(eq(dailyBars.symbol, symbol), from ? gte(dailyBars.date, from) : undefined, to ? lte(dailyBars.date, to) : undefined))
    .orderBy(asc(dailyBars.date));
  return rows.map((r) => ({
    date: r.date,
    open: toUnits(r.open),
    high: toUnits(r.high),
    low: toUnits(r.low),
    close: toUnits(r.close),
    volume: r.volume,
  }));
}

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null) => (x === null ? "—" : x.toFixed(2));

function row(label: string, s: Metrics, b: Metrics): string {
  return [
    label.padEnd(20),
    `return ${pct(s.totalReturn).padStart(7)} vs ${pct(b.totalReturn).padStart(7)}`,
    `max drawdown ${pct(s.maxDrawdown).padStart(7)} vs ${pct(b.maxDrawdown).padStart(7)}`,
    `Sharpe ${num(s.sharpe).padStart(5)} vs ${num(b.sharpe).padStart(5)}`,
    `trades ${String(s.roundTrips).padStart(3)}, win rate ${pct(s.winRate)}`,
  ].join("  ");
}

async function main(): Promise<number> {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  loadEnvFileIfPresent(`${root}.env`);
  const config = loadConfig(process.env);
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", default: "XIU" },
      benchmark: { type: "string", default: "XIU" },
      fast: { type: "string", default: "20" },
      slow: { type: "string", default: "50" },
      from: { type: "string" },
      to: { type: "string" },
    },
  });
  const symbol = values.symbol.toUpperCase();
  const benchmark = values.benchmark.toUpperCase();
  const params = { fast: Number(values.fast), slow: Number(values.slow), cashShare: 0.98 };

  const { db, pool } = createDatabase(config.DATABASE_URL);
  try {
    const bars = await loadBars(db, symbol, values.from, values.to);
    const benchmarkBars = await loadBars(db, benchmark, values.from, values.to);
    if (bars.length === 0) {
      console.error(`No stored bars for ${symbol}. Run npm run data:sync first (with ${symbol} in MARKET_DATA_SYMBOLS).`);
      return 1;
    }
    const report = buildReport({
      symbol,
      benchmark,
      params,
      bars,
      benchmarkBars,
      startingCash: toUnits(config.PAPER_STARTING_CASH),
      costs: DEFAULT_COSTS,
    });

    console.log(`${report.strategy} on ${symbol}, ${report.period.from} to ${report.period.to} (${report.period.bars} days), vs buy-and-hold ${benchmark}`);
    console.log(`Held-out period starts ${report.period.holdoutFrom}. Strategy vs benchmark:`);
    console.log(row("All", report.all.strategy, report.all.benchmark));
    console.log(row("In-sample (70%)", report.inSample.strategy, report.inSample.benchmark));
    console.log(row("Held out (30%)", report.holdout.strategy, report.holdout.benchmark));
    if (report.skipped.length > 0) console.log(`${report.skipped.length} orders skipped (see JSON).`);
    console.log(`input hash  ${report.inputHash}`);
    console.log(`result hash ${report.resultHash}`);

    const dir = `${root}evals/backtests`;
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/${symbol}-ma${params.fast}-${params.slow}-${report.resultHash.slice(0, 12)}.json`;
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`saved ${file.slice(root.length)}`);
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof ConfigError ? error.message : `Failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  },
);
