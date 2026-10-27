import type { RiskSettings } from "@yuyufx/shared";
import type { Database } from "../../src/db/client.js";
import { DEFAULT_RISK_SETTINGS } from "../../src/risk/rules.js";
import { saveRiskSettings } from "../../src/risk/store.js";

/**
 * Loose limits for tests about order mechanics (fills, cancels, P&L), so the
 * risk rules don't get in the way. Risk rules have their own tests that use the
 * real defaults.
 */
export async function relaxRisk(db: Database, userId: string, allowedSymbols: string[], overrides: Partial<RiskSettings> = {}) {
  await saveRiskSettings(db, userId, {
    ...DEFAULT_RISK_SETTINGS,
    requireStopLoss: false,
    riskPerTradeBps: 1_000,
    maxPositionBps: 20_000, // 200%: above anything cash allows, so the cash rule is what bites
    maxOpenPositions: 100,
    maxOrdersPerMinute: 120,
    allowedSymbols,
    ...overrides,
  });
}
