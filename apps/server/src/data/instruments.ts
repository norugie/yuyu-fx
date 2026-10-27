import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { instruments } from "../db/schema.js";
import type { QuestradeClient } from "./questrade/client.js";

/** Questrade's numeric id for a TSX symbol: from the instruments table, or looked up once and saved. */
export async function questradeSymbolId(db: Database, client: QuestradeClient, symbol: string): Promise<number> {
  const [row] = await db.select().from(instruments).where(eq(instruments.symbol, symbol));
  if (row?.questradeSymbolId) return row.questradeSymbolId;

  const found = await client.findSymbol(symbol);
  await db
    .insert(instruments)
    .values({ symbol, questradeSymbolId: found.symbolId, description: found.description, currency: found.currency ?? "CAD" })
    .onConflictDoUpdate({
      target: instruments.symbol,
      set: { questradeSymbolId: found.symbolId, description: found.description, updatedAt: new Date() },
    });
  return found.symbolId;
}
