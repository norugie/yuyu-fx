import type { BacktestFill, EquityPoint } from "./backtest.js";
import { SCALE } from "../money.js";

// Backtest metrics (task 4.7, PRD AC6.3 / eval E1). Statistics use plain numbers
// (they're ratios, not money that must add up to the cent).
//
// - Total return: final / starting equity - 1.
// - Max drawdown: the worst fall from a previous high, as a fraction. A -25%
//   drawdown means at some point you'd lost a quarter from your best level.
// - Sharpe ratio: average daily return / standard deviation of daily returns,
//   times sqrt(252) to make it yearly. Return per unit of "bumpiness"; above
//   ~1 is decent, but backtests overstate it. Risk-free rate assumed 0 here.
// - Round trip: buying into a position and selling all of it. Win rate is the
//   share of round trips that made money after fees.

export interface Metrics {
  from: string;
  to: string;
  days: number;
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  /** Null when there's no volatility to divide by (e.g. all cash). */
  sharpe: number | null;
  roundTrips: number;
  /** Null when there were no completed round trips. */
  winRate: number | null;
}

const toNumber = (units: bigint) => Number(units) / Number(SCALE);

export function maxDrawdown(values: readonly number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst;
}

export function sharpeRatio(values: readonly number[]): number | null {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1] ?? 0;
    if (prev > 0) returns.push((values[i] ?? 0) / prev - 1);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd < 1e-12) return null;
  return (mean / sd) * Math.sqrt(252);
}

/** Long-only round trips: from the first buy out of flat to the sell that makes it flat again. */
export function roundTrips(fills: readonly BacktestFill[]): { closedOn: string; pnl: number }[] {
  const trips: { closedOn: string; pnl: number }[] = [];
  let position = 0;
  let cashFlow = 0n;
  for (const f of fills) {
    const value = f.price * BigInt(f.quantity);
    cashFlow += f.side === "buy" ? -value - f.fee : value - f.fee;
    position += f.side === "buy" ? f.quantity : -f.quantity;
    if (position === 0) {
      trips.push({ closedOn: f.date, pnl: toNumber(cashFlow) });
      cashFlow = 0n;
    }
  }
  return trips;
}

/** Metrics for the equity points in [from, to] (inclusive dates), and trips closed in that window. */
export function computeMetrics(equity: readonly EquityPoint[], fills: readonly BacktestFill[], from?: string, to?: string): Metrics {
  const window = equity.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  const values = window.map((p) => toNumber(p.equity));
  const first = window[0];
  const last = window.at(-1);
  const trips = roundTrips(fills).filter((t) => (!first || t.closedOn >= first.date) && (!last || t.closedOn <= last.date));
  const startEquity = values[0] ?? 0;
  const endEquity = values.at(-1) ?? 0;
  return {
    from: first?.date ?? "",
    to: last?.date ?? "",
    days: window.length,
    startEquity,
    endEquity,
    totalReturn: startEquity > 0 ? endEquity / startEquity - 1 : 0,
    maxDrawdown: maxDrawdown(values),
    sharpe: sharpeRatio(values),
    roundTrips: trips.length,
    winRate: trips.length > 0 ? trips.filter((t) => t.pnl > 0).length / trips.length : null,
  };
}
