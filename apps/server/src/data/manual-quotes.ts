import { desc, eq } from "drizzle-orm";
import type { QuoteSource } from "@yuyufx/shared";
import type { Database } from "../db/client.js";
import { quotes } from "../db/schema.js";
import type { LatestQuote, PriceSource } from "./price-source.js";

/**
 * The quotes table: prices typed in by Youmu (source "manual") and stored
 * Questrade quotes. `latest` reads the newest stored price from any source,
 * without any network call.
 */
export interface ManualPriceSource extends PriceSource {
  record(input: { symbol: string; price: string; enteredBy: string | null; at: Date; source?: QuoteSource }): Promise<LatestQuote>;
}

export function createManualPriceSource(db: Database): ManualPriceSource {
  return {
    async latest(symbol) {
      const [row] = await db
        .select({
          symbol: quotes.symbol,
          price: quotes.price,
          source: quotes.source,
          quotedAt: quotes.quotedAt,
        })
        .from(quotes)
        .where(eq(quotes.symbol, symbol))
        .orderBy(desc(quotes.quotedAt), desc(quotes.id))
        .limit(1);
      return row ?? null;
    },

    async record({ symbol, price, enteredBy, at, source = "manual" }) {
      const [row] = await db
        .insert(quotes)
        .values({ symbol, price, source, quotedAt: at, enteredBy })
        .returning({
          symbol: quotes.symbol,
          price: quotes.price,
          source: quotes.source,
          quotedAt: quotes.quotedAt,
        });
      if (!row) throw new Error("Insert returned no row");
      return row;
    },
  };
}
