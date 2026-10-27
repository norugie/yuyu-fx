import type { Database } from "../db/client.js";
import type { Logger } from "../log.js";
import { questradeSymbolId } from "./instruments.js";
import type { ManualPriceSource } from "./manual-quotes.js";
import type { PriceSource } from "./price-source.js";
import { priceToDecimal, QuestradeAuthError, QuestradeNotConfiguredError, type QuestradeClient } from "./questrade/client.js";

// Prices from Questrade with the typed-in/stored price as fallback (PRD AC10.2).
// A fetched quote is stored (source "questrade"), so history, the broker and the
// UI all read from one place, and `onNewQuote` lets resting orders react to it.

export interface QuestradePriceSourceDeps {
  db: Database;
  client: QuestradeClient;
  stored: ManualPriceSource;
  now: () => Date;
  log: Logger;
  /** Called after a fresh quote is stored (the broker re-checks resting orders). */
  onNewQuote: (symbol: string) => Promise<unknown>;
  /** Don't ask Questrade again for the same symbol within this time. */
  cacheMs?: number;
}

export function createQuestradePriceSource(deps: QuestradePriceSourceDeps): PriceSource {
  const cacheMs = deps.cacheMs ?? 15_000;
  const lastFetch = new Map<string, number>();
  // When Questrade isn't set up, stop asking for a while instead of failing every request.
  let disabledUntil = 0;

  async function refresh(symbol: string): Promise<void> {
    const nowMs = deps.now().getTime();
    if (nowMs < disabledUntil) return;
    const last = lastFetch.get(symbol);
    if (last !== undefined && nowMs - last < cacheMs) return;
    lastFetch.set(symbol, nowMs);

    try {
      const id = await questradeSymbolId(deps.db, deps.client, symbol);
      const quote = await deps.client.quote(id);
      await deps.stored.record({
        symbol,
        price: priceToDecimal(quote.price),
        enteredBy: null,
        at: deps.now(),
        source: "questrade",
      });
      await deps.onNewQuote(symbol);
    } catch (error) {
      if (error instanceof QuestradeNotConfiguredError) {
        disabledUntil = nowMs + 5 * 60_000;
        return;
      }
      if (error instanceof QuestradeAuthError) {
        // The token is dead; asking again won't help. Pause and say what to do.
        disabledUntil = nowMs + 5 * 60_000;
        deps.log("questrade.auth.failed", { message: error.message });
        return;
      }
      // Fall back to the stored price; say why without any secrets.
      deps.log("questrade.quote.failed", {
        symbol,
        error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      });
    }
  }

  return {
    async latest(symbol) {
      await refresh(symbol);
      return deps.stored.latest(symbol);
    },
  };
}
