import { eq } from "drizzle-orm";
import type { RiskSettings } from "@yuyufx/shared";
import type { Database } from "../db/client.js";
import { riskSettings, tradingState, type TradingStateRow } from "../db/schema.js";
import { DEFAULT_RISK_SETTINGS } from "./rules.js";

// Reading and writing risk settings and trading state. A user without a
// settings row gets the defaults (ARCHITECTURE §6) on first use.

function toSettings(row: typeof riskSettings.$inferSelect): RiskSettings {
  return {
    riskPerTradeBps: row.riskPerTradeBps,
    maxPositionBps: row.maxPositionBps,
    maxOpenPositions: row.maxOpenPositions,
    dailyLossBps: row.dailyLossBps,
    maxDrawdownBps: row.maxDrawdownBps,
    requireStopLoss: row.requireStopLoss,
    maxOrderQuantity: row.maxOrderQuantity,
    maxLimitDeviationBps: row.maxLimitDeviationBps,
    maxExitDeviationBps: row.maxExitDeviationBps,
    maxOrdersPerMinute: row.maxOrdersPerMinute,
    allowedSymbols: row.allowedSymbols,
  };
}

/** The user's limits; created with the defaults if missing. `defaultSymbols` seeds the whitelist. */
export async function loadRiskSettings(db: Database, userId: string, defaultSymbols: readonly string[]): Promise<RiskSettings> {
  const [row] = await db.select().from(riskSettings).where(eq(riskSettings.userId, userId));
  if (row) return toSettings(row);
  const [created] = await db
    .insert(riskSettings)
    .values({ userId, ...DEFAULT_RISK_SETTINGS, allowedSymbols: [...defaultSymbols] })
    .onConflictDoNothing()
    .returning();
  if (created) return toSettings(created);
  const [again] = await db.select().from(riskSettings).where(eq(riskSettings.userId, userId));
  if (!again) throw new Error("Could not create risk settings");
  return toSettings(again);
}

export async function saveRiskSettings(db: Database, userId: string, settings: RiskSettings): Promise<void> {
  await db
    .insert(riskSettings)
    .values({ userId, ...settings })
    .onConflictDoUpdate({ target: riskSettings.userId, set: { ...settings, updatedAt: new Date() } });
}

export type TradingState = Pick<TradingStateRow, "peakEquity" | "dailyHaltDate" | "drawdownHaltedAt" | "killSwitchAt">;

export async function loadTradingState(db: Database, userId: string): Promise<TradingState> {
  const [row] = await db.select().from(tradingState).where(eq(tradingState.userId, userId));
  return row ?? { peakEquity: null, dailyHaltDate: null, drawdownHaltedAt: null, killSwitchAt: null };
}

export async function saveTradingState(db: Database, userId: string, state: TradingState): Promise<void> {
  await db
    .insert(tradingState)
    .values({ userId, ...state })
    .onConflictDoUpdate({ target: tradingState.userId, set: { ...state, updatedAt: new Date() } });
}
