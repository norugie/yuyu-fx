// `npm run data:check -- XIU RY`: prove the Questrade connection works.
// Prints symbol ids, a live quote (with Questrade's own "delay" in minutes) and the
// last month of daily candles. Never prints tokens.

import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, loadEnvFileIfPresent } from "../config.js";
import { questradeSymbolId } from "../data/instruments.js";
import { exchangeDate } from "../data/price-source.js";
import { createQuestradeClient } from "../data/questrade/client.js";
import { createDbTokenStore } from "../data/questrade/token-store.js";
import { createDatabase } from "../db/client.js";
import { parseSecretsKey } from "../secrets.js";

async function main(): Promise<number> {
  loadEnvFileIfPresent(fileURLToPath(new URL("../../../../.env", import.meta.url)));
  const config = loadConfig(process.env);
  const symbols = process.argv.slice(2).map((s) => s.toUpperCase());
  const wanted = symbols.length > 0 ? symbols : ["XIU", "RY"];
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const events: string[] = [];
  try {
    const client = createQuestradeClient({
      store: createDbTokenStore(db, parseSecretsKey(config.SECRETS_KEY)),
      envRefreshToken: config.QUESTRADE_REFRESH_TOKEN,
      log: (event) => events.push(event),
    });
    const today = exchangeDate(new Date());
    const monthAgo = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
    for (const symbol of wanted) {
      const id = await questradeSymbolId(db, client, symbol);
      const quote = await client.quote(id);
      const candles = await client.dailyCandles(id, monthAgo, today);
      const last = candles.at(-1);
      console.log(
        `${symbol}: Questrade id ${id}; last price ${quote.price} (delay ${quote.delayMinutes} min, last trade ${quote.lastTradeTime ?? "?"}); ` +
          `${candles.length} daily candles ${candles[0]?.date ?? "-"} to ${last?.date ?? "-"}, last close ${last?.close ?? "-"}`,
      );
    }
    if (events.includes("questrade.token.refreshed")) console.log("Token exchanged; the new refresh token is stored encrypted.");
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof ConfigError ? error.message : `Failed: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`);
    process.exit(1);
  },
);
