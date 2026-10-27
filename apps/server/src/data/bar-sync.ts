import { eq, max } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { dailyBars } from "../db/schema.js";
import type { Logger } from "../log.js";
import { questradeSymbolId } from "./instruments.js";
import { exchangeDate } from "./price-source.js";
import { priceToDecimal, type QuestradeCandle, type QuestradeClient } from "./questrade/client.js";

// Daily-bar sync (PRD AC10.1): fetch only what's missing, never duplicate.

export interface SyncResult {
  symbol: string;
  from: string | null;
  to: string;
  added: number;
  skipped: number;
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A candle the database would reject (or that makes no sense) is skipped, not fatal. */
function isSane(c: QuestradeCandle): boolean {
  const values = [c.open, c.high, c.low, c.close];
  return (
    values.every((v) => Number.isFinite(v) && v > 0) &&
    c.low <= Math.min(c.open, c.close) &&
    c.high >= Math.max(c.open, c.close) &&
    Number.isInteger(c.volume) &&
    c.volume >= 0
  );
}

export async function syncSymbol(
  db: Database,
  client: QuestradeClient,
  symbol: string,
  now: Date,
  log: Logger,
  yearsBack = 10,
): Promise<SyncResult> {
  // Up to yesterday: today's bar isn't final until the close.
  const to = addDays(exchangeDate(now), -1);
  const [row] = await db.select({ last: max(dailyBars.date) }).from(dailyBars).where(eq(dailyBars.symbol, symbol));
  const from = row?.last ? addDays(row.last, 1) : addDays(to, -Math.round(yearsBack * 365.25));
  if (from > to) return { symbol, from: null, to, added: 0, skipped: 0 };

  const id = await questradeSymbolId(db, client, symbol);
  const candles = await client.dailyCandles(id, from, to);
  const good = candles.filter(isSane);
  const skipped = candles.length - good.length;
  for (const bad of candles.filter((c) => !isSane(c))) log("bars.sync.skipped", { symbol, date: bad.date });

  let added = 0;
  // Insert in chunks; an existing (symbol, date) is left alone, so re-running is harmless.
  for (let i = 0; i < good.length; i += 500) {
    const chunk = good.slice(i, i + 500).map((c) => ({
      symbol,
      date: c.date,
      open: priceToDecimal(c.open),
      high: priceToDecimal(c.high),
      low: priceToDecimal(c.low),
      close: priceToDecimal(c.close),
      volume: c.volume,
      source: "questrade" as const,
    }));
    const inserted = await db.insert(dailyBars).values(chunk).onConflictDoNothing().returning({ date: dailyBars.date });
    added += inserted.length;
  }
  log("bars.sync", { symbol, from, to, added, skipped });
  return { symbol, from, to, added, skipped };
}

/** Sync every symbol; one symbol failing doesn't stop the others. */
export async function syncAll(
  db: Database,
  client: QuestradeClient,
  symbols: string[],
  now: Date,
  log: Logger,
): Promise<{ results: SyncResult[]; failed: { symbol: string; error: string }[] }> {
  const results: SyncResult[] = [];
  const failed: { symbol: string; error: string }[] = [];
  for (const symbol of symbols) {
    try {
      results.push(await syncSymbol(db, client, symbol, now, log));
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      failed.push({ symbol, error: message });
      log("bars.sync.failed", { symbol, error: message });
    }
  }
  return { results, failed };
}
