import type { RiskSettings } from "@yuyufx/shared";
import { fromUnits, toUnits, type Units } from "../money.js";
import type { TradingState } from "./store.js";

// Account-level guards (PRD AC5.3, AC5.5), as a pure function.
//
// - Daily loss limit: if today's loss reaches X% of the equity the day started
//   with, automation stops until the next trading day. A bad day stays a bad day
//   instead of turning into a disaster.
// - Max drawdown: if equity falls Y% below its highest point ("peak"), automation
//   stops until Youmu looks at what happened and re-enables it.
// - Kill switch: stops automation until re-enabled.
// - Stale data: automation needs today's data; if the daily bars are out of
//   date, it pauses.

export interface GuardInput {
  settings: RiskSettings;
  state: TradingState;
  equity: Units;
  /** Equity when today began (exchange time). */
  equityAtOpen: Units;
  /** Exchange date today, YYYY-MM-DD. */
  today: string;
  now: Date;
  /** Market-data symbols whose daily bars are out of date. */
  staleDataSymbols: string[];
}

export interface GuardResult {
  /** State to store (peak moved up, halts set). */
  state: TradingState;
  /** Plain reasons for each active halt; empty means automation may run. */
  halts: string[];
  /** Fall from the peak as a fraction (0.05 = 5% below the peak). */
  drawdown: number;
  /** The loss today that triggers the daily halt (negative). */
  dailyLossLimit: Units;
}

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-CA")}%`;

export function evaluateGuards(input: GuardInput): GuardResult {
  const { settings, equity, equityAtOpen, today } = input;
  const previousPeak = input.state.peakEquity === null ? null : toUnits(input.state.peakEquity);
  const peak = previousPeak === null || equity > previousPeak ? equity : previousPeak;
  const state: TradingState = { ...input.state, peakEquity: fromUnits(peak) };

  const dailyLossLimit = -((equityAtOpen * BigInt(settings.dailyLossBps)) / 10_000n);
  if (equityAtOpen > 0n && equity - equityAtOpen <= dailyLossLimit && state.dailyHaltDate !== today) {
    state.dailyHaltDate = today;
  }

  const drawdown = peak > 0n ? Number(((peak - equity) * 1_000_000n) / peak) / 1_000_000 : 0;
  if (drawdown * 10_000 >= settings.maxDrawdownBps && state.drawdownHaltedAt === null) {
    state.drawdownHaltedAt = input.now;
  }

  const halts: string[] = [];
  if (state.dailyHaltDate === today) halts.push(`daily loss limit reached (${pct(settings.dailyLossBps)}); resumes next trading day`);
  if (state.drawdownHaltedAt) halts.push(`drawdown limit reached (${pct(settings.maxDrawdownBps)} below the peak); re-enable in Settings`);
  if (state.killSwitchAt) halts.push("kill switch pressed; re-enable in Settings");
  if (input.staleDataSymbols.length > 0) halts.push(`daily bars out of date for ${input.staleDataSymbols.join(", ")}`);

  return { state, halts, drawdown, dailyLossLimit };
}
