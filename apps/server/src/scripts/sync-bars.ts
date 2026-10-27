// `npm run data:sync`: fetch missing daily bars from Questrade for MARKET_DATA_SYMBOLS.

import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, loadEnvFileIfPresent } from "../config.js";
import { syncAll } from "../data/bar-sync.js";
import { createQuestradeClient } from "../data/questrade/client.js";
import { createDbTokenStore } from "../data/questrade/token-store.js";
import { createDatabase } from "../db/client.js";
import { parseSecretsKey } from "../secrets.js";

async function main(): Promise<number> {
  loadEnvFileIfPresent(fileURLToPath(new URL("../../../../.env", import.meta.url)));
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const quiet = () => {};
  try {
    const client = createQuestradeClient({
      store: createDbTokenStore(db, parseSecretsKey(config.SECRETS_KEY)),
      envRefreshToken: config.QUESTRADE_REFRESH_TOKEN,
      log: quiet,
    });
    const { results, failed } = await syncAll(db, client, config.MARKET_DATA_SYMBOLS, new Date(), quiet);
    for (const r of results) {
      console.log(
        r.from
          ? `${r.symbol}: ${r.added} new bars (${r.from} to ${r.to})${r.skipped ? `, ${r.skipped} bad candles skipped` : ""}`
          : `${r.symbol}: up to date (through ${r.to})`,
      );
    }
    for (const f of failed) console.error(`${f.symbol}: failed - ${f.error}`);
    return failed.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof ConfigError ? error.message : `Failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  },
);
