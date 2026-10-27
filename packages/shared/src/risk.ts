import { z } from "zod";
import { symbolSchema } from "./trading.js";

// Risk limits and status (PRD F5). Percentages are basis points: 100 bp = 1%.

const bps = (min: number, max: number, what: string) =>
  z
    .number({ error: `${what} must be a number` })
    .int({ error: `${what} must be a whole number of basis points` })
    .min(min, { error: `${what} must be at least ${min / 100}%` })
    .max(max, { error: `${what} must be at most ${max / 100}%` });

const whole = (min: number, max: number, what: string) =>
  z
    .number({ error: `${what} must be a number` })
    .int({ error: `${what} must be a whole number` })
    .min(min, { error: `${what} must be at least ${min}` })
    .max(max, { error: `${what} must be at most ${max.toLocaleString("en-CA")}` });

export const riskSettingsSchema = z.object({
  /** Most you may lose on one trade if its stop-loss is hit, as % of equity. */
  riskPerTradeBps: bps(1, 1_000, "Risk per trade"),
  /** Largest position in one stock, as % of equity. */
  maxPositionBps: bps(100, 10_000, "Max position size"),
  maxOpenPositions: whole(1, 100, "Max open positions"),
  /** Loss in one day (as % of the day's starting equity) that stops automation until tomorrow. */
  dailyLossBps: bps(10, 5_000, "Daily loss limit"),
  /** Fall from the equity peak that stops automation until you re-enable it. */
  maxDrawdownBps: bps(100, 9_000, "Max drawdown"),
  /** Every new position must come with a stop-loss (a bracket order). */
  requireStopLoss: z.boolean(),
  maxOrderQuantity: whole(1, 1_000_000, "Max shares per order"),
  maxLimitDeviationBps: bps(10, 5_000, "Limit price distance"),
  maxExitDeviationBps: bps(10, 9_000, "Stop/target distance"),
  maxOrdersPerMinute: whole(1, 120, "Orders per minute"),
  /** Symbols new positions may be opened in. */
  allowedSymbols: z.array(symbolSchema).max(500, { error: "At most 500 allowed symbols" }),
});
export type RiskSettings = z.infer<typeof riskSettingsSchema>;

/** PUT /api/risk/settings: any subset of the settings, plus the password (asked again). */
export const updateRiskSettingsSchema = z.object({
  password: z.string().min(1).max(256),
  settings: riskSettingsSchema.partial(),
});

/** POST /api/risk/resume */
export const resumeSchema = z.object({ password: z.string().min(1).max(256) });

/** POST /api/risk/kill-switch */
export const killSwitchSchema = z.object({ flatten: z.boolean() });

export interface RiskStatus {
  settings: RiskSettings;
  /** False while any halt is active: automated (rules/AI) orders are refused. */
  automationAllowed: boolean;
  /** Plain reasons for each active halt. */
  halts: string[];
  equity: string;
  peakEquity: string;
  /** Fall from the peak, as a fraction (0.05 = 5% below the peak). */
  drawdown: number;
  todayPnl: string;
  /** Today's loss that triggers the daily halt (a negative amount). */
  dailyLossLimit: string;
  killSwitchActive: boolean;
}

export interface KillSwitchResult {
  cancelledOrders: number;
  /** Positions sold (when flatten was chosen). */
  flattened: string[];
  /** Positions that couldn't be sold, with the reason (e.g. no fresh price). */
  notFlattened: { symbol: string; reason: string }[];
}
