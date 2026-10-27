import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { orders } from "../db/schema.js";
import type { Logger } from "../log.js";
import type { PriceSource } from "./price-source.js";

// Keeps prices fresh for symbols with waiting orders, so limits, stops and
// bracket exits fill without anyone typing a price (PRD AC10.2).

export async function pollOnce(db: Database, prices: PriceSource, log: Logger): Promise<string[]> {
  const rows = await db
    .selectDistinct({ symbol: orders.symbol })
    .from(orders)
    .where(and(eq(orders.status, "open"), eq(orders.mode, "paper")));
  const symbols = rows.map((r) => r.symbol).sort();
  for (const symbol of symbols) {
    try {
      await prices.latest(symbol); // fetches, stores, and re-checks resting orders
    } catch (error) {
      log("quote.poll.failed", { symbol, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  return symbols;
}

/** Poll every `intervalMs`. Returns a function that stops it. */
export function startQuotePoller(db: Database, prices: PriceSource, log: Logger, intervalMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // never overlap two polls
    running = true;
    pollOnce(db, prices, log).finally(() => {
      running = false;
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
